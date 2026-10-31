// src/services/timerAuthority.coordinator.ts

export type AuthorityMessageType =
  | 'AUTHORITY_ACQUIRED'
  | 'AUTHORITY_RELEASED'
  | 'REQUEST_TRANSFER'
  | 'TRANSFER_GRANTED';

export interface AuthorityMessage {
  type: AuthorityMessageType;
  matchId: number;
  tabId: string;
  epoch: number;
  targetTabId?: string;
  timestamp: number;
}

export interface AuthorityState {
  matchId: number;
  hasAuthority: boolean;
  isOwner: boolean;
  ownerTabId: string | null;
  epoch: number;
  tabId: string;
}

type AuthorityListener = (state: AuthorityState) => void;

interface ActiveLockRecord {
  release: () => Promise<void>;
  epoch: number;
}

class TimerAuthorityCoordinator {
  private tabId: string;
  private epochCounter = 1;
  private activeLocks = new Map<number, ActiveLockRecord>();
  private matchStates = new Map<number, { isOwner: boolean; ownerTabId: string | null; epoch: number }>();
  private listeners = new Map<number, Set<AuthorityListener>>();
  private broadcastChannel: BroadcastChannel | null = null;
  private isLocksSupported = false;
  private forceFallback = false;

  constructor() {
    this.tabId = this.generateTabId();
    this.initPlatformCapabilities();
    this.initBroadcastChannel();
  }

  private generateTabId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `tab_${crypto.randomUUID()}`;
    }
    return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private initPlatformCapabilities() {
    this.isLocksSupported =
      typeof navigator !== 'undefined' &&
      'locks' in navigator &&
      typeof navigator.locks?.request === 'function';
  }

  private initBroadcastChannel() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('scorebasket:timer:authority');
        this.broadcastChannel.onmessage = (event: MessageEvent<AuthorityMessage>) => {
          this.handleBroadcastMessage(event.data);
        };
      } catch {
        this.broadcastChannel = null;
      }
    }
  }

  public getTabId(): string {
    return this.tabId;
  }

  public isWebLocksSupported(): boolean {
    return this.isLocksSupported && !this.forceFallback;
  }

  /**
   * Obtiene el estado actual de autoridad para un partido.
   */
  public getAuthorityState(matchId: number): AuthorityState {
    const record = this.matchStates.get(matchId);
    const isOwner = record?.isOwner ?? false;
    const epoch = record?.epoch ?? 0;
    const ownerTabId = record?.ownerTabId ?? (isOwner ? this.tabId : null);

    return {
      matchId,
      hasAuthority: isOwner,
      isOwner,
      ownerTabId,
      epoch,
      tabId: this.tabId
    };
  }

  /**
   * Intenta adquirir la autoridad exclusiva sobre el cronómetro del partido.
   * Utiliza Web Locks API (`ifAvailable: true`) para garantizar exclusión mutua entre pestañas.
   */
  public async acquireAuthority(matchId: number): Promise<{ acquired: boolean; epoch: number }> {
    // Si ya somos dueños con un lock activo, devolvemos el estado actual
    const existing = this.activeLocks.get(matchId);
    if (existing && this.matchStates.get(matchId)?.isOwner) {
      return { acquired: true, epoch: existing.epoch };
    }

    const nextEpoch = ++this.epochCounter;

    // Modo degradado (sin Web Locks o forzado para tests/navegadores antiguos)
    if (!this.isWebLocksSupported()) {
      this.matchStates.set(matchId, {
        isOwner: true,
        ownerTabId: this.tabId,
        epoch: nextEpoch
      });

      this.broadcastMessage({
        type: 'AUTHORITY_ACQUIRED',
        matchId,
        tabId: this.tabId,
        epoch: nextEpoch,
        timestamp: Date.now()
      });

      this.notifyListeners(matchId);
      return { acquired: true, epoch: nextEpoch };
    }

    const lockName = `scorebasket:timer:${matchId}`;

    return new Promise<{ acquired: boolean; epoch: number }>((resolve) => {
      let lockGranted = false;

      navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          // El lock está en uso por otra pestaña
          this.matchStates.set(matchId, {
            isOwner: false,
            ownerTabId: this.matchStates.get(matchId)?.ownerTabId ?? null,
            epoch: this.matchStates.get(matchId)?.epoch ?? 0
          });
          this.notifyListeners(matchId);
          resolve({ acquired: false, epoch: 0 });
          return;
        }

        // Lock adquirido con éxito
        lockGranted = true;
        this.matchStates.set(matchId, {
          isOwner: true,
          ownerTabId: this.tabId,
          epoch: nextEpoch
        });

        let releaseLock!: () => void;
        const lockLifetimePromise = new Promise<void>((rel) => {
          releaseLock = rel;
        });

        let lockExitResolve!: () => void;
        const lockExitPromise = new Promise<void>((ex) => {
          lockExitResolve = ex;
        });

        this.activeLocks.set(matchId, {
          release: async () => {
            releaseLock();
            await lockExitPromise;
            // Pequeña pausa en microtask para asegurar que el motor de Web Locks libere el lock en el runtime
            await new Promise((r) => setTimeout(r, 20));
            this.activeLocks.delete(matchId);
          },
          epoch: nextEpoch
        });

        this.broadcastMessage({
          type: 'AUTHORITY_ACQUIRED',
          matchId,
          tabId: this.tabId,
          epoch: nextEpoch,
          timestamp: Date.now()
        });

        this.notifyListeners(matchId);
        resolve({ acquired: true, epoch: nextEpoch });

        try {
          await lockLifetimePromise;
        } finally {
          lockExitResolve();
        }
      }).catch(() => {
        if (!lockGranted) {
          resolve({ acquired: false, epoch: 0 });
        }
      });
    });
  }

  /**
   * Libera voluntariamente la autoridad sobre el cronómetro.
   */
  public async releaseAuthority(matchId: number): Promise<void> {
    const active = this.activeLocks.get(matchId);
    if (active) {
      await active.release();
    }

    const state = this.matchStates.get(matchId);
    if (state?.isOwner) {
      this.matchStates.set(matchId, {
        isOwner: false,
        ownerTabId: null,
        epoch: state.epoch
      });

      this.broadcastMessage({
        type: 'AUTHORITY_RELEASED',
        matchId,
        tabId: this.tabId,
        epoch: state.epoch,
        timestamp: Date.now()
      });

      this.notifyListeners(matchId);
    }
  }

  /**
   * Solicita cesión de autoridad a la pestaña propietaria y reintenta adquirir el control.
   */
  public async requestTransfer(matchId: number): Promise<boolean> {
    this.broadcastMessage({
      type: 'REQUEST_TRANSFER',
      matchId,
      tabId: this.tabId,
      epoch: this.matchStates.get(matchId)?.epoch ?? 0,
      timestamp: Date.now()
    });

    // Pequeña ventana de cortesía para cesión voluntaria
    await new Promise((r) => setTimeout(r, 100));

    // Intentar adquirir el lock (si la pestaña anterior cerró o cedió, se adquiere)
    const result = await this.acquireAuthority(matchId);
    return result.acquired;
  }

  /**
   * Procesa mensajes entrantes desde otras pestañas vía BroadcastChannel.
   */
  private handleBroadcastMessage(msg: AuthorityMessage) {
    if (!msg || msg.tabId === this.tabId) return;

    switch (msg.type) {
      case 'AUTHORITY_ACQUIRED': {
        // Otra pestaña adquirió la autoridad
        this.matchStates.set(msg.matchId, {
          isOwner: false,
          ownerTabId: msg.tabId,
          epoch: msg.epoch
        });
        const local = this.activeLocks.get(msg.matchId);
        if (local) {
          local.release().catch(() => {});
        }
        this.notifyListeners(msg.matchId);
        break;
      }

      case 'AUTHORITY_RELEASED': {
        const current = this.matchStates.get(msg.matchId);
        if (current?.ownerTabId === msg.tabId) {
          this.matchStates.set(msg.matchId, {
            isOwner: false,
            ownerTabId: null,
            epoch: msg.epoch
          });
          this.notifyListeners(msg.matchId);
        }
        break;
      }

      case 'REQUEST_TRANSFER': {
        const current = this.matchStates.get(msg.matchId);
        if (current?.isOwner) {
          this.releaseAuthority(msg.matchId).then(() => {
            this.broadcastMessage({
              type: 'TRANSFER_GRANTED',
              matchId: msg.matchId,
              tabId: this.tabId,
              targetTabId: msg.tabId,
              epoch: current.epoch,
              timestamp: Date.now()
            });
          });
        }
        break;
      }

      case 'TRANSFER_GRANTED': {
        if (msg.targetTabId === this.tabId) {
          this.acquireAuthority(msg.matchId);
        }
        break;
      }
    }
  }

  private broadcastMessage(msg: AuthorityMessage) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg);
      } catch {
        // BroadcastChannel cerrado o no disponible
      }
    }
  }

  /**
   * Suscripción reactiva para componentes que necesitan reaccionar a cambios de autoridad.
   */
  public subscribe(matchId: number, listener: AuthorityListener): () => void {
    if (!this.listeners.has(matchId)) {
      this.listeners.set(matchId, new Set());
    }
    const set = this.listeners.get(matchId)!;
    set.add(listener);

    // Emitir estado actual inmediatamente al suscribirse
    listener(this.getAuthorityState(matchId));

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(matchId);
      }
    };
  }

  private notifyListeners(matchId: number) {
    const set = this.listeners.get(matchId);
    if (!set || set.size === 0) return;
    const state = this.getAuthorityState(matchId);
    set.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('Error in authority listener:', err);
      }
    });
  }

  /**
   * Métodos para pruebas automatizadas y aislamiento de estado
   */
  public async _resetForTesting(options?: { forceFallback?: boolean; tabId?: string }): Promise<void> {
    const promises: Promise<void>[] = [];
    this.activeLocks.forEach((lock) => {
      promises.push(lock.release().catch(() => {}));
    });
    await Promise.all(promises);
    this.activeLocks.clear();
    this.matchStates.clear();
    this.listeners.clear();
    this.epochCounter = 1;
    this.forceFallback = options?.forceFallback ?? false;
    if (options?.tabId) {
      this.tabId = options.tabId;
    } else {
      this.tabId = this.generateTabId();
    }
  }
}

export const timerAuthorityCoordinator = new TimerAuthorityCoordinator();
export { TimerAuthorityCoordinator };

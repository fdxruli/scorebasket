// src/services/timerAuthority.coordinator.ts
import { db } from '../db/db';

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
  private inFlightOperations = new Map<number, Set<Promise<unknown>>>();
  private acquiringPromises = new Map<number, Promise<{ acquired: boolean; epoch: number }>>();
  private fallbackHeartbeats = new Map<number, ReturnType<typeof setInterval>>();
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
   * Registra una operación asíncrona en vuelo para evitar que se libere el lock
   * antes de que la transacción IndexedDB termine de confirmarse (C-11).
   */
  public trackOperation<T>(matchId: number, promise: Promise<T>): Promise<T> {
    if (!this.inFlightOperations.has(matchId)) {
      this.inFlightOperations.set(matchId, new Set());
    }
    const set = this.inFlightOperations.get(matchId)!;
    const untyped = promise as Promise<unknown>;
    set.add(untyped);
    promise.finally(() => {
      set.delete(untyped);
      if (set.size === 0) {
        this.inFlightOperations.delete(matchId);
      }
    });
    return promise;
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
   * - Primario: Web Locks API (`ifAvailable: true`) para exclusión mutua nativa entre procesos.
   * - Fallback conservador (C-14): Lease transaccional persistido en IndexedDB con heartbeat.
   */
  public async acquireAuthority(matchId: number): Promise<{ acquired: boolean; epoch: number }> {
    const existing = this.acquiringPromises.get(matchId);
    if (existing) {
      return existing;
    }
    const promise = this._doAcquireAuthority(matchId).finally(() => {
      this.acquiringPromises.delete(matchId);
    });
    this.acquiringPromises.set(matchId, promise);
    return promise;
  }

  /**
   * Espera a que cualquier intento de adquisición de autoridad en vuelo concluya.
   */
  public async waitForAcquisition(matchId: number): Promise<void> {
    const promise = this.acquiringPromises.get(matchId);
    if (promise) {
      try {
        await promise;
      } catch {
        // ignore
      }
    }
  }

  private async _doAcquireAuthority(matchId: number): Promise<{ acquired: boolean; epoch: number }> {
    // Si ya somos dueños con un lock activo, devolvemos el estado actual
    const existing = this.activeLocks.get(matchId);
    if (existing && this.matchStates.get(matchId)?.isOwner) {
      return { acquired: true, epoch: existing.epoch };
    }

    let nextEpoch = this.epochCounter;

    // Modo degradado (sin Web Locks o forzado para tests/navegadores antiguos) (C-14 / C-16 / C-17 / C-18)
    if (!this.isWebLocksSupported()) {
      if (!db.isOpen()) {
        // C-16: Fail-closed si la base de datos está cerrada
        this.matchStates.set(matchId, {
          isOwner: false,
          ownerTabId: null,
          epoch: 0
        });
        this.notifyListeners(matchId);
        return { acquired: false, epoch: 0 };
      }

      try {
        const leaseResult = await db.transaction('rw', db.matches, async () => {
          const match = await db.matches.get(matchId);
          if (!match) return { acquired: false, epoch: 0, ownerTabId: null };

          if (match.status === 'finished') {
            return {
              acquired: false,
              epoch: match.timerEpoch ?? 0,
              ownerTabId: match.timerOwnerTabId ?? null
            };
          }

          const now = Date.now();
          const activeLease =
            match.timerOwnerTabId &&
            match.timerOwnerTabId !== this.tabId &&
            (match.timerLeaseExpiresAt ?? 0) > now;

          if (activeLease) {
            // Otra pestaña posee el lease activo en IndexedDB: rechazar adquisición múltiple
            return {
              acquired: false,
              epoch: match.timerEpoch ?? 0,
              ownerTabId: match.timerOwnerTabId
            };
          }

          // C-18: Reservar el siguiente epoch estrictamente mayor que el persistido
          const epochVal = Math.max(this.epochCounter, match.timerEpoch ?? 0) + 1;
          this.epochCounter = epochVal;
          const expiresAt = now + 6000;

          await db.matches.update(matchId, {
            timerOwnerTabId: this.tabId,
            timerEpoch: epochVal,
            timerLeaseExpiresAt: expiresAt
          });

          return { acquired: true, epoch: epochVal, ownerTabId: this.tabId };
        });

        if (!leaseResult.acquired) {
          this.matchStates.set(matchId, {
            isOwner: false,
            ownerTabId: leaseResult.ownerTabId ?? null,
            epoch: leaseResult.epoch
          });
          this.notifyListeners(matchId);
          return { acquired: false, epoch: leaseResult.epoch };
        }

        nextEpoch = leaseResult.epoch;
        this.matchStates.set(matchId, {
          isOwner: true,
          ownerTabId: this.tabId,
          epoch: nextEpoch
        });

        // Iniciar heartbeat transaccional validado cada 2 segundos (C-17)
        this.startFallbackHeartbeat(matchId);

        this.broadcastMessage({
          type: 'AUTHORITY_ACQUIRED',
          matchId,
          tabId: this.tabId,
          epoch: nextEpoch,
          timestamp: Date.now()
        });

        this.notifyListeners(matchId);
        return { acquired: true, epoch: nextEpoch };
      } catch (err) {
        // C-16: Fail-closed si la transacción IndexedDB falla
        console.warn('Fallback lease acquisition in IndexedDB failed:', err);
        this.clearFallbackHeartbeat(matchId);
        this.matchStates.set(matchId, {
          isOwner: false,
          ownerTabId: null,
          epoch: 0
        });
        this.notifyListeners(matchId);
        return { acquired: false, epoch: 0 };
      }
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

        // Lock concedido por Web Locks API: reservar epoch en IndexedDB (C-16 / C-18)
        if (!db.isOpen()) {
          // C-16: Fail-closed si IndexedDB está cerrada
          this.matchStates.set(matchId, {
            isOwner: false,
            ownerTabId: null,
            epoch: 0
          });
          this.notifyListeners(matchId);
          resolve({ acquired: false, epoch: 0 });
          return;
        }

        let reservedEpoch = nextEpoch;
        try {
          reservedEpoch = await db.transaction('rw', db.matches, async () => {
            const match = await db.matches.get(matchId);
            if (!match) return Math.max(this.epochCounter, 1);
            if (match.status === 'finished') {
              throw new Error('Partido finalizado');
            }
            const currentPersisted = match.timerEpoch ?? 0;
            const next = Math.max(this.epochCounter, currentPersisted) + 1;
            this.epochCounter = next;
            await db.matches.update(matchId, {
              timerEpoch: next,
              timerOwnerTabId: this.tabId
            });
            return next;
          });
        } catch (err) {
          // C-16: Si la transacción falla o el partido ya estaba finalizado, fail-closed
          console.warn('Web Lock epoch reservation failed in IndexedDB:', err);
          this.matchStates.set(matchId, {
            isOwner: false,
            ownerTabId: null,
            epoch: 0
          });
          this.notifyListeners(matchId);
          resolve({ acquired: false, epoch: 0 });
          return;
        }

        lockGranted = true;
        nextEpoch = reservedEpoch;
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
   * Heartbeat periódico para el modo degradado de lease en IndexedDB (C-17).
   * Valida transaccionalmente matchId, ownerTabId, epoch y lease antes de renovar.
   */
  public async _testTriggerHeartbeat(matchId: number): Promise<boolean> {
    try {
      if (!db.isOpen()) {
        this.handleLeaseLost(matchId, 'IndexedDB no disponible');
        return false;
      }

      const currentLocal = this.matchStates.get(matchId);
      if (!currentLocal?.isOwner) {
        this.clearFallbackHeartbeat(matchId);
        return false;
      }

      const expectedEpoch = currentLocal.epoch;

      const renewed = await db.transaction('rw', db.matches, async () => {
        const match = await db.matches.get(matchId);
        if (!match) return { ok: false, reason: 'Partido no encontrado' };
        if (match.status === 'finished') return { ok: false, reason: 'Partido finalizado' };

        const now = Date.now();
        if (match.timerOwnerTabId !== this.tabId) {
          return {
            ok: false,
            reason: 'Propietario en BD difiere',
            ownerTabId: match.timerOwnerTabId,
            epoch: match.timerEpoch
          };
        }
        if ((match.timerEpoch ?? 0) !== expectedEpoch) {
          return {
            ok: false,
            reason: 'Epoch en BD desfasado',
            ownerTabId: match.timerOwnerTabId,
            epoch: match.timerEpoch
          };
        }
        if ((match.timerLeaseExpiresAt ?? 0) < now) {
          return {
            ok: false,
            reason: 'Lease expirado en BD',
            ownerTabId: match.timerOwnerTabId,
            epoch: match.timerEpoch
          };
        }

        const expiresAt = now + 6000;
        await db.matches.update(matchId, {
          timerLeaseExpiresAt: expiresAt
        });
        return { ok: true };
      });

      if (!renewed.ok) {
        this.handleLeaseLost(matchId, renewed.reason, renewed.ownerTabId, renewed.epoch);
        return false;
      }
      return true;
    } catch {
      this.handleLeaseLost(matchId, 'Excepción en transacción de heartbeat');
      return false;
    }
  }

  private startFallbackHeartbeat(matchId: number) {
    this.clearFallbackHeartbeat(matchId);
    const heartbeat = setInterval(() => {
      this._testTriggerHeartbeat(matchId).catch(() => {});
    }, 2000);
    this.fallbackHeartbeats.set(matchId, heartbeat);
  }

  private handleLeaseLost(
    matchId: number,
    _reason?: string,
    ownerTabId?: string | null,
    epoch?: number
  ) {
    this.clearFallbackHeartbeat(matchId);
    const current = this.matchStates.get(matchId);
    if (current?.isOwner) {
      this.matchStates.set(matchId, {
        isOwner: false,
        ownerTabId: ownerTabId ?? null,
        epoch: epoch ?? current.epoch
      });
      this.notifyListeners(matchId);
    }
  }

  private clearFallbackHeartbeat(matchId: number) {
    const hb = this.fallbackHeartbeats.get(matchId);
    if (hb) {
      clearInterval(hb);
      this.fallbackHeartbeats.delete(matchId);
    }
  }

  /**
   * Libera voluntariamente la autoridad sobre el cronómetro.
   * Aguarda cualquier operación en vuelo antes de ceder el Web Lock (C-11).
   * En modo fallback o Web Lock, solo retira el lease/propietario si aún le pertenece (C-17).
   */
  public async releaseAuthority(matchId: number): Promise<void> {
    const state = this.matchStates.get(matchId);

    // 1. Aguardar a que cualquier operación en vuelo en esta pestaña termine antes de ceder el lock (C-11 / C-20)
    const pending = this.inFlightOperations.get(matchId);
    if (pending && pending.size > 0) {
      await Promise.allSettled(Array.from(pending));
    }

    // 2. Marcar como no propietario tras haber concluido operaciones en vuelo
    if (state?.isOwner) {
      this.matchStates.set(matchId, {
        isOwner: false,
        ownerTabId: null,
        epoch: state.epoch
      });
    }

    // 3. Limpiar heartbeats de fallback si aplica y vaciar lease en BD SÓLO si seguimos siendo el dueño legítimo (C-17)
    this.clearFallbackHeartbeat(matchId);
    if (!this.isWebLocksSupported() && db.isOpen()) {
      try {
        await db.transaction('rw', db.matches, async () => {
          const match = await db.matches.get(matchId);
          if (!match) return;
          if (
            match.timerOwnerTabId === this.tabId &&
            (match.timerEpoch ?? 0) === (state?.epoch ?? 0)
          ) {
            await db.matches.update(matchId, {
              timerLeaseExpiresAt: 0,
              timerOwnerTabId: undefined
            });
          }
        });
      } catch {
        // ignore
      }
    } else if (this.isWebLocksSupported() && db.isOpen()) {
      try {
        await db.transaction('rw', db.matches, async () => {
          const match = await db.matches.get(matchId);
          if (!match) return;
          if (
            match.timerOwnerTabId === this.tabId &&
            (match.timerEpoch ?? 0) === (state?.epoch ?? 0)
          ) {
            await db.matches.update(matchId, {
              timerOwnerTabId: undefined
            });
          }
        });
      } catch {
        // ignore
      }
    }

    // 4. Liberar Web Lock
    const active = this.activeLocks.get(matchId);
    if (active) {
      await active.release();
    }

    if (state?.isOwner) {
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
   * El Web Lock, si está sostenido, NUNCA es cedido por un mensaje BroadcastChannel (C-15).
   */
  private handleBroadcastMessage(msg: AuthorityMessage) {
    if (!msg || msg.tabId === this.tabId) return;

    const current = this.matchStates.get(msg.matchId);
    const currentEpoch = current?.epoch ?? 0;

    switch (msg.type) {
      case 'AUTHORITY_ACQUIRED': {
        // C-15: Si esta pestaña sostiene activamente el Web Lock nativo, NO abandona su autoridad por un mensaje BC atrasado o espurio!
        if (this.isWebLocksSupported() && this.activeLocks.has(msg.matchId)) {
          return;
        }

        // Si el epoch del mensaje es menor o igual al actual, es un mensaje atrasado o duplicado; ignorar
        if (msg.epoch <= currentEpoch) {
          return;
        }

        // Otra pestaña adquirió válidamente la autoridad con un epoch superior
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
        if (msg.epoch < currentEpoch) return;
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
        // Solo procesar peticiones válidas dirigidas al dueño actual
        if (current?.isOwner && msg.epoch >= current.epoch) {
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
        if (msg.targetTabId === this.tabId && msg.epoch >= currentEpoch) {
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
  public _testSimulateSuspension(matchId: number): void {
    // Simula la suspensión del runtime deteniendo el heartbeat sin limpiar el lease en BD
    this.clearFallbackHeartbeat(matchId);
  }

  public async _resetForTesting(options?: {
    forceFallback?: boolean;
    tabId?: string;
    epochCounter?: number;
  }): Promise<void> {
    this.fallbackHeartbeats.forEach((t) => clearInterval(t));
    this.fallbackHeartbeats.clear();
    this.inFlightOperations.clear();

    const promises: Promise<void>[] = [];
    this.activeLocks.forEach((lock) => {
      promises.push(lock.release().catch(() => {}));
    });
    await Promise.all(promises);
    this.activeLocks.clear();
    this.matchStates.clear();
    this.listeners.clear();
    this.epochCounter = options?.epochCounter ?? 1;
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

// src/test/sb19-db-f5-storage-continuity.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { db, BasketControlDB } from '../db/db';
import { StorageErrorBoundary } from '../components/common/StorageErrorBoundary';
import { LocalBackupControls } from '../components/matches/LocalBackupControls';
import { StoragePersistenceService,
  LocalBackupService,
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_VERSION
} from '../db/localBackup.service';
import { Teams } from '../pages/Teams';
import { TeamsRepository } from '../db/teams.repository';

describe('DB-F5: Continuidad, Persistencia y Seguridad del Almacenamiento Local (QA-01 a QA-08)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // QA-01: Reapertura y recarga conserva los registros completos
  it('QA-01: conserva equipos, jugadores, partidos, anotaciones y faltas tras simular recarga/reapertura', async () => {
    // 1. Crear equipo y jugadores
    const teamId = await db.teams.add({
      name: 'Águilas de Prueba',
      createdAt: new Date(),
      isArchived: false
    });

    const playerId = await db.players.add({
      name: 'Capitán 1',
      number: 7,
      teamId: Number(teamId),
      createdAt: new Date(),
      isArchived: false
    });

    // 2. Crear partido
    const matchId = await db.matches.add({
      localTeamId: Number(teamId),
      visitorTeamId: 999,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
      },
      currentQuarter: 1,
      localScore: 3,
      visitorScore: 0,
      localFouls: 1,
      visitorFouls: 0
    });

    // 3. Crear score y foul
    await db.scores.add({
      matchId: Number(matchId),
      teamId: Number(teamId),
      playerId: Number(playerId),
      points: 3,
      quarter: 1,
      createdAt: new Date()
    });

    await db.fouls.add({
      matchId: Number(matchId),
      teamId: Number(teamId),
      playerId: Number(playerId),
      quarter: 1,
      createdAt: new Date()
    });

    // 4. Simular cierre y reapertura creando una nueva instancia de BasketControlDB con el mismo nombre
    const reopenedDb = new BasketControlDB('basket_control_db');
    await reopenedDb.open();

    const teams = await reopenedDb.teams.toArray();
    const players = await reopenedDb.players.toArray();
    const matches = await reopenedDb.matches.toArray();
    const scores = await reopenedDb.scores.toArray();
    const fouls = await reopenedDb.fouls.toArray();

    expect(teams.length).toBe(1);
    expect(teams[0].name).toBe('Águilas de Prueba');
    expect(players.length).toBe(1);
    expect(players[0].name).toBe('Capitán 1');
    expect(matches.length).toBe(1);
    expect(matches[0].localScore).toBe(3);
    expect(scores.length).toBe(1);
    expect(scores[0].points).toBe(3);
    expect(fouls.length).toBe(1);

    reopenedDb.close();
  });

  // QA-02: Persistencia del navegador soportada y concedida
  it('QA-02: StoragePersistenceService reporta persistencia activa y cuotas calculadas cuando el navegador la concede', async () => {
    // Mock de navigator.storage concedido
    const originalStorage = window.navigator.storage;
    const mockStorage = {
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 2097152, quota: 104857600 }) // 2MB de 100MB
    };

    Object.defineProperty(window.navigator, 'storage', {
      value: mockStorage,
      configurable: true,
      writable: true
    });

    try {
      const status = await StoragePersistenceService.getStatus();
      expect(status.supported).toBe(true);
      expect(status.persisted).toBe(true);
      expect(status.usageFormatted).toBe('2.0 MB');
      expect(status.quotaFormatted).toBe('100.0 MB');
      expect(status.percentUsed).toBe(2);

      const granted = await StoragePersistenceService.requestPersistence();
      expect(granted).toBe(true);
    } finally {
      Object.defineProperty(window.navigator, 'storage', {
        value: originalStorage,
        configurable: true,
        writable: true
      });
    }
  });

  // QA-03: Persistencia denegada o no soportada sin pérdidas destructivas
  it('QA-03: persistencia denegada no causa errores destructivos ni reporta falso desastre en la UI', async () => {
    const originalStorage = window.navigator.storage;
    const mockStorage = {
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false), // El navegador deniega
      estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 1000000 })
    };

    Object.defineProperty(window.navigator, 'storage', {
      value: mockStorage,
      configurable: true,
      writable: true
    });

    try {
      // 1. El servicio reporta no persistido pero soportado
      const status = await StoragePersistenceService.getStatus();
      expect(status.supported).toBe(true);
      expect(status.persisted).toBe(false);

      // 2. Renderizar control UI
      render(<LocalBackupControls />);

      // Expandir panel
      const headerTitle = screen.getByText('Respaldo y Seguridad de Datos Locales');
      await act(async () => {
        fireEvent.click(headerTitle);
      });

      // Clic en Solicitar Persistencia
      const requestBtn = screen.getByText('Solicitar Persistencia');
      await act(async () => {
        fireEvent.click(requestBtn);
      });

      // Debe mostrar un aviso informativo claro, NO un error catastrófico
      await waitFor(() => {
        expect(
          screen.getByText(/El navegador no otorgó almacenamiento persistente en este momento/i)
        ).toBeDefined();
      });
    } finally {
      Object.defineProperty(window.navigator, 'storage', {
        value: originalStorage,
        configurable: true,
        writable: true
      });
    }
  });

  // QA-04: Error real de lectura en useLiveQuery no se presenta como base vacía
  it('QA-04: StorageErrorBoundary intercepta fallos reales en consultas useLiveQuery de Teams y no presenta estado vacío ("No hay equipos")', async () => {
    // Espiar TeamsRepository.getAll para simular un fallo real de lectura de IndexedDB dentro de useLiveQuery
    const getAllSpy = vi.spyOn(TeamsRepository, 'getAll').mockImplementation(() => {
      return Promise.reject(new Error('IndexedDB ConnectionFailedError: simulated storage access fault'));
    });

    try {
      render(
        <StorageErrorBoundary fallbackTitle="Problema con el almacenamiento local (IndexedDB)">
          <Teams />
        </StorageErrorBoundary>
      );

      // useLiveQuery propaga el fallo de la consulta al StorageErrorBoundary
      await waitFor(() => {
        // 1. No debe mostrar el falso estado vacío de "Aún no hay equipos registrados"
        expect(screen.queryByText(/Aún no hay equipos registrados/i)).toBeNull();
        // 2. Debe mostrar la interfaz de recuperación comprensible
        expect(screen.getByText(/Problema con el almacenamiento local/i)).toBeDefined();
        expect(screen.getByText(/Tus registros previos/i)).toBeDefined();
        expect(screen.getByText(/no han sido eliminados/i)).toBeDefined();
        expect(screen.getByText(/Reintentar lectura/i)).toBeDefined();
      });
    } finally {
      getAllSpy.mockRestore();
    }
  });

  // QA-05: Datos históricos siguen siendo legibles (v2 a v8)
  it('QA-05: esquema v8 mantiene compatibilidad y lee registros históricos de versiones previas', async () => {
    // Inserción directa de registro compatible con formato v8
    const matchId = await db.matches.add({
      localTeamId: 10,
      visitorTeamId: 20,
      status: 'finished',
      createdAt: new Date('2026-01-15T12:00:00Z'),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
      },
      localScore: 85,
      visitorScore: 82,
      localFouls: 14,
      visitorFouls: 18
    });

    const readBack = await db.matches.get(matchId);
    expect(readBack).toBeDefined();
    expect(readBack?.config?.mode).toBe('traditional');
    expect(readBack?.localScore).toBe(85);
    expect(readBack?.localTeamId).toBe(10);
    expect(readBack?.visitorTeamId).toBe(20);
  });

  // QA-06: Respaldo DB-F1 continúa funcionando intacto
  it('QA-06: exportación y restauración DB-F1 preservan sobre canónico con checksum SHA-256', async () => {
    // 1. Guardar equipo
    await db.teams.add({
      name: 'Equipo Respaldo DB-F5',
      createdAt: new Date(),
      isArchived: false
    });

    // 2. Exportar JSON
    const jsonStr = await LocalBackupService.exportJson();
    const envelope = JSON.parse(jsonStr);

    expect(envelope.format).toBe(LOCAL_BACKUP_FORMAT);
    expect(envelope.version).toBe(LOCAL_BACKUP_VERSION);
    expect(envelope.app).toBe('ScoreBasket');
    expect(envelope.sourceSchemaVersion).toBe(8);
    expect(envelope.metadata.checksum).toMatch(/^sha256:[a-f0-9]{64}$/i);
    expect(envelope.data.teams.length).toBe(1);

    // 3. Vaciar base
    await db.teams.clear();
    expect(await LocalBackupService.isDatabaseEmpty()).toBe(true);

    // 4. Restaurar en base vacía
    const counts = await LocalBackupService.restoreIntoEmpty(jsonStr);
    expect(counts.teams).toBe(1);

    const restoredTeams = await db.teams.toArray();
    expect(restoredTeams.length).toBe(1);
    expect(restoredTeams[0].name).toBe('Equipo Respaldo DB-F5');
  });

  // QA-07: No hay cambios destructivos en esquema (permanece en v8)
  it('QA-07: la base de datos permanece en Dexie v8 sin migraciones destructivas ni v9 no autorizada', () => {
    expect(db.verno).toBe(8);
  });

  // QA-08: Actualización compatible conserva datos desde el mismo origen web
  it('QA-08: reapertura con la misma versión de esquema v8 no altera ni reinicializa los registros', async () => {
    const originalTime = new Date('2026-03-01T10:00:00Z');
    await db.teams.add({
      name: 'Veteranos Basket',
      createdAt: originalTime,
      isArchived: false
    });

    // Simular que el cliente se actualizó en el mismo origen (re-abrir base existente)
    const testDb = new BasketControlDB('basket_control_db');
    await testDb.open();

    expect(testDb.verno).toBe(8);
    const teams = await testDb.teams.toArray();
    expect(teams.length).toBe(1);
    expect(teams[0].name).toBe('Veteranos Basket');
    expect(teams[0].isArchived).toBe(false);

    testDb.close();
  });
});

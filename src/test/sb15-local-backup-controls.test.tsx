// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { db } from '../db/db';
import { LocalBackupControls } from '../components/matches/LocalBackupControls';
import {
  LocalBackupService,
  computeEnvelopeChecksum,
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_VERSION,
  type BackupData
} from '../db/localBackup.service';

describe('LocalBackupControls UI Component', () => {
  beforeEach(async () => {
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

  it('renders collapsed by default and expands on click', async () => {
    render(<LocalBackupControls />);

    expect(screen.getByText('Respaldo y Seguridad de Datos Locales')).toBeDefined();
    expect(screen.queryByText('Descargar Respaldo (JSON)')).toBeNull();

    // Clic para expandir
    const headerTitle = screen.getByText('Respaldo y Seguridad de Datos Locales');
    await act(async () => {
      fireEvent.click(headerTitle);
    });

    expect(screen.getByText('Descargar Respaldo (JSON)')).toBeDefined();
    expect(screen.getByText('Restaurar Respaldo')).toBeDefined();
  });

  it('handles export action and displays success feedback', async () => {
    // Añadir un equipo de prueba
    await db.teams.add({ name: 'Export Team', createdAt: new Date() });

    vi.spyOn(LocalBackupService, 'exportToFile').mockResolvedValue({
      filename: 'scorebasket-backup-test.json',
      counts: { teams: 1, players: 0, matches: 0, scores: 0, fouls: 0 },
      downloadInitiated: true
    });

    render(<LocalBackupControls />);

    // Expandir
    await act(async () => {
      fireEvent.click(screen.getByText('Respaldo y Seguridad de Datos Locales'));
    });

    const exportBtn = screen.getByText('Descargar Respaldo (JSON)');
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Respaldo generado exitosamente|Descarga iniciada/i)).toBeDefined();
    });
  });

  it('blocks restore when database already contains data and displays clear warning', async () => {
    // Añadir un equipo para que la base no esté vacía
    await db.teams.add({ name: 'Existing Team', createdAt: new Date() });

    render(<LocalBackupControls />);

    // Expandir
    await act(async () => {
      fireEvent.click(screen.getByText('Respaldo y Seguridad de Datos Locales'));
    });

    // Simular selección de archivo
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText(/Restauración bloqueada: la base de datos ya contiene datos/i)).toBeDefined();
    });
  });

  it('prompts confirmation when database is empty and restores successfully', async () => {
    render(<LocalBackupControls />);

    // Expandir
    await act(async () => {
      fireEvent.click(screen.getByText('Respaldo y Seguridad de Datos Locales'));
    });

    const rawData = {
      teams: [{ id: 1, name: 'Restored Team', createdAt: '2026-01-01T00:00:00Z', isArchived: false }],
      players: [],
      matches: [],
      scores: [],
      fouls: []
    };
    const counts = { teams: 1, players: 0, matches: 0, scores: 0, fouls: 0 };
    const exportedAt = new Date().toISOString();
    const checksum = await computeEnvelopeChecksum({
      app: 'ScoreBasket',
      counts,
      data: rawData as unknown as BackupData,
      exportedAt,
      format: LOCAL_BACKUP_FORMAT,
      sourceSchemaVersion: 8,
      version: LOCAL_BACKUP_VERSION
    });
    const mockBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt,
      metadata: {
        counts,
        checksumAlgorithm: 'SHA-256',
        checksum,
        generatedBy: 'ScoreBasket Test'
      },
      data: rawData
    };

    const file = new File([JSON.stringify(mockBackup)], 'backup.json', { type: 'application/json' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText('Confirmar Restauración')).toBeDefined();
      expect(screen.getByText('Sí, Restaurar Datos')).toBeDefined();
    });

    // Confirmar
    await act(async () => {
      fireEvent.click(screen.getByText('Sí, Restaurar Datos'));
    });

    await waitFor(() => {
      expect(screen.getByText(/¡Restauración exitosa!/i)).toBeDefined();
    });

    expect(await db.teams.count()).toBe(1);
  });
});

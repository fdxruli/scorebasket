// src/components/teams/teamEditorHelpers.ts
import type { Player } from '../../db/models';
import { validateJerseyNumber } from '../../db/players.repository';

export interface EditablePlayerRow {
  id?: number;
  name: string;
  /** Valor editable crudo en el formulario (permite ver lo que el usuario escribe mientras lo corrige) */
  numberInput: string;
  /** Valor normalizado (solo definido cuando numberInput es válido y no vacío) */
  normalizedNumber?: number;
  /** Error visible específico del dorsal */
  numberError?: string;
  /** Error visible específico del nombre */
  nameError?: string;
}

/**
 * Convierte jugadores activos de la BD al estado editable del formulario.
 */
export function toEditablePlayerRows(players: Player[]): EditablePlayerRow[] {
  return players
    .filter(p => !p.isArchived)
    .map(p => ({
      id: p.id,
      name: p.name,
      numberInput: p.number !== undefined && p.number !== null ? String(p.number) : '',
      normalizedNumber: p.number ?? undefined,
      numberError: undefined,
      nameError: undefined
    }));
}

/**
 * Recalcula errores de validación (formato de dorsal, duplicados entre filas y nombre vacío)
 * sobre las filas editables, sin alterar nunca el texto crudo `numberInput` escrito por el usuario.
 */
export function revalidateEditableRows(rows: EditablePlayerRow[]): EditablePlayerRow[] {
  // 1. Primera pasada: validar formato individual de cada fila
  const firstPass = rows.map(row => {
    const trimmedName = (row.name || '').trim();
    const nameError = trimmedName ? undefined : 'El nombre del jugador es obligatorio.';

    const jVal = validateJerseyNumber(row.numberInput);
    if (!jVal.isValid) {
      return {
        ...row,
        normalizedNumber: undefined,
        numberError: jVal.error || 'El dorsal debe ser un número entero entre 0 y 99.',
        nameError
      };
    }

    return {
      ...row,
      normalizedNumber: jVal.normalizedNumber,
      numberError: undefined,
      nameError
    };
  });

  // 2. Segunda pasada: detectar dorsales normalizados duplicados dentro del formulario
  const counts = new Map<number, number>();
  for (const r of firstPass) {
    if (r.numberError === undefined && r.normalizedNumber !== undefined) {
      counts.set(r.normalizedNumber, (counts.get(r.normalizedNumber) || 0) + 1);
    }
  }

  return firstPass.map(r => {
    if (
      r.numberError === undefined &&
      r.normalizedNumber !== undefined &&
      (counts.get(r.normalizedNumber) || 0) > 1
    ) {
      return {
        ...r,
        numberError: `El dorsal #${r.normalizedNumber} está duplicado en la plantilla.`
      };
    }
    return r;
  });
}

/**
 * Actualiza un campo ('name' | 'number') de una fila editable preservando siempre el valor escrito
 * por el usuario y actualizando los mensajes de error visibles correspondientes (C-05).
 */
export function updateEditablePlayerRow(
  rows: EditablePlayerRow[],
  index: number,
  field: 'name' | 'number',
  rawValue: string
): EditablePlayerRow[] {
  const updated = rows.map((row, idx) => {
    if (idx !== index) return row;
    if (field === 'number') {
      return {
        ...row,
        numberInput: rawValue
      };
    }
    return {
      ...row,
      name: rawValue
    };
  });

  return revalidateEditableRows(updated);
}

/**
 * Valida el borrador para agregar un nuevo jugador a la lista editable.
 */
export function validateNewPlayerDraft(
  existingRows: EditablePlayerRow[],
  rawName: string,
  rawNumberInput: string
): {
  isValid: boolean;
  error?: string;
  row?: EditablePlayerRow;
} {
  const trimmedName = (rawName || '').trim();
  if (!trimmedName) {
    return {
      isValid: false,
      error: 'El nombre del jugador es obligatorio.'
    };
  }

  const jVal = validateJerseyNumber(rawNumberInput);
  if (!jVal.isValid) {
    return {
      isValid: false,
      error: jVal.error || 'El dorsal debe ser un número entero entre 0 y 99.'
    };
  }

  if (jVal.normalizedNumber !== undefined) {
    const duplicate = existingRows.some(r => {
      const rVal = validateJerseyNumber(r.numberInput);
      return rVal.isValid && rVal.normalizedNumber === jVal.normalizedNumber;
    });
    if (duplicate) {
      return {
        isValid: false,
        error: `El dorsal #${jVal.normalizedNumber} ya está en la lista de esta plantilla.`
      };
    }
  }

  return {
    isValid: true,
    row: {
      name: trimmedName,
      numberInput: jVal.normalizedNumber !== undefined ? String(jVal.normalizedNumber) : '',
      normalizedNumber: jVal.normalizedNumber,
      numberError: undefined,
      nameError: undefined
    }
  };
}

/**
 * Prepara y valida todas las filas editables antes de persistir en base de datos.
 * Si alguna fila tiene nombre vacío, dorsal inválido o duplicado, rechaza el guardado
 * devolviendo las filas con sus errores visibles y el índice del primer campo con error.
 */
export function prepareEditableRosterForSave(rows: EditablePlayerRow[]): {
  isValid: boolean;
  validatedRows: EditablePlayerRow[];
  firstInvalidIndex: number;
  firstInvalidField?: 'name' | 'number';
  errorSummary?: string;
  payload: Array<{ id?: number; name: string; number?: number }>;
} {
  const validatedRows = revalidateEditableRows(rows);

  for (let i = 0; i < validatedRows.length; i++) {
    const r = validatedRows[i];
    if (r.nameError) {
      return {
        isValid: false,
        validatedRows,
        firstInvalidIndex: i,
        firstInvalidField: 'name',
        errorSummary: r.nameError,
        payload: []
      };
    }
    if (r.numberError) {
      return {
        isValid: false,
        validatedRows,
        firstInvalidIndex: i,
        firstInvalidField: 'number',
        errorSummary: `Jugador "${r.name}": ${r.numberError}`,
        payload: []
      };
    }
  }

  const payload = validatedRows.map(r => ({
    id: r.id,
    name: r.name.trim(),
    number: r.normalizedNumber
  }));

  return {
    isValid: true,
    validatedRows,
    firstInvalidIndex: -1,
    payload
  };
}

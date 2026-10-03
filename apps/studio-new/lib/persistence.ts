/**
 * Persistence layer for CampusDocument.
 *
 * Stage 2 — minimal localStorage adapter.
 * No editor context, no React hooks, no EditorProvider.
 * Just load/save primitives that the full editor will use later.
 */

import { serializeDocument, deserializeDocument } from '@navi/core'
import type { CampusDocument } from '@navi/core'

/** localStorage key for the active campus document. */
const STORAGE_KEY = 'navi-studio:campus-document'

/**
 * Save a CampusDocument to localStorage.
 * Returns true on success, false on failure.
 */
export function saveDocumentToLocal(doc: CampusDocument): boolean {
  try {
    const json = serializeDocument(doc)
    localStorage.setItem(STORAGE_KEY, json)
    return true
  } catch (err) {
    console.error('[persistence] save failed:', err)
    return false
  }
}

/**
 * Load a CampusDocument from localStorage.
 * Returns the document, or null if none saved / invalid.
 */
export function loadDocumentFromLocal(): CampusDocument | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY)
    if (!json) return null
    return deserializeDocument(json)
  } catch (err) {
    console.error('[persistence] load failed:', err)
    return null
  }
}

/**
 * Check if a saved document exists in localStorage.
 */
export function hasSavedDocument(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

/**
 * Remove the saved document from localStorage.
 */
export function clearDocument(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Create an empty default CampusDocument.
 * Useful as a starting point when no saved document exists yet.
 */
export function createEmptyDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      name: 'Untitled Campus',
      description: '',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

/**
 * Load or create a document.
 * Returns the saved document if one exists, otherwise a fresh empty one.
 */
export function loadOrCreateDocument(): CampusDocument {
  return loadDocumentFromLocal() ?? createEmptyDocument()
}

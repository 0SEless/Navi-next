export interface DirtyFlags {
  geometryDirty: boolean
  metadataDirty: boolean
  assetDirty: boolean
  compilerDirty: boolean
}

export function createDirtyTracker() {
  let flags: DirtyFlags = {
    geometryDirty: false,
    metadataDirty: false,
    assetDirty: false,
    compilerDirty: false,
  }

  return {
    get flags(): Readonly<DirtyFlags> {
      return { ...flags }
    },

    get isDirty(): boolean {
      return flags.geometryDirty || flags.metadataDirty || flags.assetDirty || flags.compilerDirty
    },

    markGeometryDirty(): void {
      flags.geometryDirty = true
      flags.compilerDirty = true
    },

    markMetadataDirty(): void {
      flags.metadataDirty = true
      flags.compilerDirty = true
    },

    markAssetDirty(triggersCompiler: boolean = false): void {
      flags.assetDirty = true
      if (triggersCompiler) {
        flags.compilerDirty = true
      }
    },

    markCompilerDirty(): void {
      flags.compilerDirty = true
    },

    clearGeometryDirty(): void {
      flags.geometryDirty = false
    },

    clearMetadataDirty(): void {
      flags.metadataDirty = false
    },

    clearAssetDirty(): void {
      flags.assetDirty = false
    },

    clearCompilerDirty(): void {
      flags.compilerDirty = false
    },

    clearAll(): void {
      flags = {
        geometryDirty: false,
        metadataDirty: false,
        assetDirty: false,
        compilerDirty: false,
      }
    },

    snapshot(): DirtyFlags {
      return { ...flags }
    },
  }
}

export type DirtyTracker = ReturnType<typeof createDirtyTracker>

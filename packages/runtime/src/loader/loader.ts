import type { LoadResult } from './types'
import { FilesystemReader } from './package-reader'
import { Sha256Verifier } from './checksum-verifier'
import { ArtifactHydrator } from './artifact-hydrator'
import { ReferenceValidator } from './reference-validator'
import { PackageLoader } from './package-loader'

export async function load(path: string): Promise<LoadResult> {
  const reader = new FilesystemReader(path)
  const verifier = new Sha256Verifier()
  const hydrator = new ArtifactHydrator()
  const refValidator = new ReferenceValidator()
  const loader = new PackageLoader(reader, verifier, hydrator, refValidator)
  return loader.load()
}

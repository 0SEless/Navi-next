import { assertSafeTestEnvironment } from './safety'

/**
 * Playwright global setup: every spec in the project runs through the guard,
 * so no suite can silently target the production Supabase project.
 */
export default async function globalSetup(): Promise<void> {
  const ref = assertSafeTestEnvironment(process.env, process.cwd())
  console.log(`[e2e-safety] Supabase project under test: ${ref}`)
}

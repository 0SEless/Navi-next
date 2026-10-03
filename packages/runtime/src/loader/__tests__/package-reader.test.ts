import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { FilesystemReader } from '../package-reader'

const fixturesPath = resolve(__dirname, '../../../test/fixtures')

describe('FilesystemReader', () => {
  const reader = new FilesystemReader(fixturesPath)

  it('readFile returns correct string content', async () => {
    const content = await reader.readFile('manifest.json')
    const expected = readFileSync(resolve(fixturesPath, 'manifest.json'), 'utf-8')
    expect(content).toBe(expected)
  })

  it('readBytes returns Uint8Array with correct length', async () => {
    const bytes = await reader.readBytes('manifest.json')
    const expected = readFileSync(resolve(fixturesPath, 'manifest.json'))
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(expected.length)
  })

  it('readFile on missing file throws ENOENT', async () => {
    await expect(reader.readFile('nonexistent.json')).rejects.toThrow('ENOENT')
  })

  it('readBytes on missing file throws ENOENT', async () => {
    await expect(reader.readBytes('nonexistent.json')).rejects.toThrow('ENOENT')
  })

  it('path resolution joins base with relative path', async () => {
    const navigationGraph = await reader.readFile('navigation.graph.json')
    const parsed = JSON.parse(navigationGraph)
    expect(parsed.nodes).toBeDefined()
    expect(parsed.edges).toBeDefined()
  })

  it('readBytes returns exact raw bytes for graph file', async () => {
    const bytes = await reader.readBytes('navigation.graph.json')
    const raw = readFileSync(resolve(fixturesPath, 'navigation.graph.json'))
    expect(Buffer.from(bytes).equals(raw)).toBe(true)
  })
})

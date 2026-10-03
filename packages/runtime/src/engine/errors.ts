export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}

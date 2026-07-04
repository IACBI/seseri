export interface Env {
  KV: KVNamespace;
}

export type AppContext = { Bindings: Env };

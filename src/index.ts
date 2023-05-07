import { handleRequest } from './handler'

export default {
    fetch(request: Request, env: Env) {
        return handleRequest(request, env)
    },
}

export interface Env {
    APP_SECRET: string
    shopStorage: KVNamespace
}

import { ShopInterface, ShopRepositoryInterface } from '@friendsofshopware/app-server-sdk'
import { Shop } from './repository'

export async function getShopByAuth(request: Request, storage: ShopRepositoryInterface): Promise<ShopInterface | null> {
    let authHeader = request.headers.get('Authorization')

    if (typeof authHeader !== 'string') {
        return null
    }

    if (!authHeader.startsWith('Basic ')) {
        return null
    }

    authHeader = atob(authHeader.substring(6))

    const values = authHeader.split(':')

    if (values.length !== 2) {
        return null
    }

    const shop = (await storage.getShopById(values[0])) as Shop

    if (shop === null) {
        return null
    }

    if (shop.customFields.password === values[1]) {
        return shop
    }

    return null
}

import { ShopRepository } from "shopware-app-server-sdk/repository";
import { Shop } from "shopware-app-server-sdk/shop";

export async function getShopByAuth(request: Request, storage: ShopRepository): Promise<Shop|null> {
    let authHeader = request.headers.get('Authorization');

    if (typeof authHeader !== 'string') {
        return null
    }

    if (!authHeader.startsWith('Basic ')) {
        return null;
    }

    authHeader = atob(authHeader.substring(6));

    const values = authHeader.split(':');

    if (values.length !== 2) {
        return null;
    }

    return storage.getShopById(values[0])
}
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

    const shop = await storage.getShopById(values[0])

    if (shop === null) {
        return null;
    }

    // App is currently deactivated
    if (shop.customFields.active === undefined || shop.customFields.active === false) {
        return null;
    }

    if (shop.customFields.password === values[1]) {
        return shop;
    }

    return null;
}
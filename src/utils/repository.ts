import { ShopInterface } from '@friendsofshopware/app-server-sdk'
import { CloudflareShopRepository } from '@friendsofshopware/app-server-sdk-cloudflare'
import { generateRandomString } from './random'

/**
 * We need own implementation of Shop and ShopRepository as we have already data
 * @todo remove this when we have migrated all data in KV
 */
export class Shop implements ShopInterface {
    constructor(public id: string, public shopUrl: string, public shopSecret: string, public clientId: string | null = null, public clientSecret: string | null = null, public customFields: any = {}) {}

    getShopId(): string {
        return this.id
    }
    getShopUrl(): string {
        return this.shopUrl
    }
    getShopSecret(): string {
        return this.shopSecret
    }
    getShopClientId(): string | null {
        return this.clientId
    }
    getShopClientSecret(): string | null {
        return this.clientSecret
    }
    setShopCredentials(clientId: string, clientSecret: string): void {
        this.clientId = clientId
        this.clientSecret = clientSecret
    }
}

export class ShopRepository extends CloudflareShopRepository {
    createShopStruct(shopId: string, shopUrl: string, shopSecret: string): ShopInterface {
        const shop = new Shop(shopId, shopUrl, shopSecret)

        shop.customFields.password = generateRandomString(16)

        return shop
    }

    deserializeShop(data: any): ShopInterface {
        data = JSON.parse(data)
        return new Shop(data.id || '', data.shopUrl || '', data.shopSecret || '', data.clientId || '', data.clientSecret || '', data.customFields || {})
    }
}

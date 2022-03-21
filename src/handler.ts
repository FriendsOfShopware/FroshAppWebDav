import { App } from "shopware-app-server-sdk";
import { Config } from "shopware-app-server-sdk/config";
import { WebCryptoHmacSigner } from "shopware-app-server-sdk/component/signer";
import { convertRequest, convertResponse, CloudflareShopRepository } from "shopware-app-server-sdk/runtime/cf-worker";
import { HttpClient } from "shopware-app-server-sdk/component/http-client";
import XMLBuilder from "./utils/xml";
import { getShopByAuth } from "./utils/auth";
import { Folder, getFolderTree } from "./utils/tree";

const cfg: Config = {
    appName: 'FroshWebDav',
    appSecret: 'aClGgcSrikPWLI674NI3R84clyC7gyOS',
    authorizeCallbackUrl: 'https://froshwebdav.shyim.workers.dev/authorize/callback'
};

export async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // This requires that an KV storage has been bound to shopStorage
    // @ts-ignore
    const app = new App(cfg, new CloudflareShopRepository(globalThis.shopStorage), new WebCryptoHmacSigner());

    if (url.pathname.startsWith('/authorize/callback')) {
        const req = await convertRequest(request);
        return await convertResponse(await app.registration.authorizeCallback(req));
    }

    if (url.pathname.startsWith('/authorize')) {
        const req = await convertRequest(request);
        return await convertResponse(await app.registration.authorize(req));
    }

    //const shop = await getShopByAuth(request, app.repository);
    const shop = await app.repository.getShopById('66nXHnfQ8hgvb31O');

    if (shop === null) {
        return new Response("cannot find shop by credentials", {
            status: 401
        });
    }

    const client = new HttpClient(shop);

    let response = new Response(null, {
        status: 405,
    });

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Allow': 'OPTIONS, LOCK, DELETE, PROPPATCH, COPY, MOVE, UNLOCK, PROPFIND',
                'Ms-Author-Via': 'DAV',
                'DAV': '1, 2',
            }
        });
    }

    if (request.method === 'PROPFIND') {
        let path = url.pathname.substring(1);
        if (path.endsWith('/')) {
            path = path.substring(0, path.length - 1);
        }

        const depth = parseInt(request.headers.get('depth') || '1');

        let root: Folder|null = await getFolderTree(client);

        if (path.length) {
            const parts = path.split('/').map(part => decodeURIComponent(part));

            root = root.findFolderByPath(parts);

            if (root === null) {
                return new Response('cannot find folder by path', {
                    status: 404
                })
            }
        }

        const builder = new XMLBuilder('D:multistatus', {
            'xmlns:D': 'DAV:',
        })

        builder.add(buildFolder(root))

        if (depth > 0) {
            for (const folder of root.children) {
                builder.add(buildFolder(folder))
            }
    
            const res = await client.post('/search/media', {
                filter: [
                    {
                        type: 'equals',
                        field: 'mediaFolderId',
                        value: root.id,
                    }
                ]
            });
    
            for (const result of res.body.data) {
                builder.add(buildFile(root, result));
            }
        }

        return new Response(builder.build(), {
            status: 207,
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        })
    }

    if (request.method === 'GET') {
        let path = url.pathname.substring(1);
        const parts = path.split('/').map(part => decodeURIComponent(part));

        const fileNameComplete = (parts.pop() as string);
        const fileSplits = fileNameComplete.split('.');

        if (fileSplits.length === 1) {
            return new Response('invalid file name', {
                status: 500
            });
        }

        let root: Folder|null = await getFolderTree(client);

        if (parts.length) {
            root = root.findFolderByPath(parts);

            if (root === null) {
                return new Response('cannot find folder by path', {
                    status: 404
                })
            }
        }

        const fileExtension = fileSplits.pop();
        const fileName = fileSplits.join('.');

        const res = await client.post('/search/media', {
            filter: [
                {
                    type: 'multi',
                    operator: 'and',
                    queries: [
                        {
                            type: 'equals',
                            field: 'mediaFolderId',
                            value: root.id,
                        },
                        {
                            type: 'equals',
                            field: 'fileName',
                            value: fileName
                        },
                        {
                            type: 'equals',
                            field: 'fileExtension',
                            value: fileExtension
                        }
                    ]
                }
            ],
        });

        if (res.body.data.length === 0) {
            return new Response('cannot find by name', {
                status: 500
            });
        }

        return await fetch(res.body.data[0].url, {
            headers: {
                Range: request.headers.get('Range') || ''
            }
        })
    }

    return response;
}

function buildFile(folder: Folder, file: any): XMLBuilder {
    const builder = new XMLBuilder('D:response')
    builder.elem('D:href', `${folder.getPath()}${encodeURIComponent(file.fileName)}.${file.fileExtension}`)
    const propStat = builder.elem('D:propstat')
    propStat.elem('D:status', `HTTP/1.1 200 OK`)
    const prop = propStat.elem('D:prop')
    prop.elem('D:getetag', file.id)
    prop.elem('D:getlastmodified', date2RFC1123(file.uploadedAt))
    prop.elem('D:creationdate', date2RFC3339(file.uploadedAt))
    if (file.displayName) {
        prop.elem('D:displayname', `${encodeURIComponent(file.fileName)}.${file.fileExtension}`)
    }
    prop.elem('D:getcontentlength', file.fileSize)
    prop.elem('D:getcontenttype', file.mimeType)

    const lock = prop.elem('D:supportedlock').elem('D:lockentry', undefined, {
        'xmlns:D': 'DAV:',
    });

    lock.elem('D:lockscope').elem('D:exclusive');
    lock.elem('D:locktype').elem('D:write');

    return builder
}

function buildFolder(folder: Folder): XMLBuilder {
    const builder = new XMLBuilder('D:response')
    builder.elem('D:href', `${folder.getPath()}`)
    const propStat = builder.elem('D:propstat')
    propStat.elem('D:status', `HTTP/1.1 200 OK`)
    const prop = propStat.elem('D:prop')
    prop.elem('D:getlastmodified', date2RFC1123(folder.createdAt))
    prop.elem('D:displayname', folder.name)
    const resourceType = prop.elem('D:resourcetype')
    resourceType.elem('D:collection', undefined, {'xmlns:D': 'DAV:'})

    const lock = prop.elem('D:supportedlock', undefined, {
        'xmlns:D': 'DAV:',
    });

    lock.elem('D:lockscope').elem('D:exclusive');
    lock.elem('D:locktype').elem('D:write');

    return builder
}

export function date2RFC3339(date?: Date | string): string {
    date = date || new Date()
    if (typeof date == 'string') date = new Date(date)
    return date.toISOString()
}

export function date2RFC1123(date?: Date | string): string {
    date = date || new Date()
    if (typeof date == 'string') date = new Date(date)
    return date.toUTCString()
}
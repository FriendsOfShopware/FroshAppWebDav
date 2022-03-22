import { App } from "shopware-app-server-sdk";
import { Config } from "shopware-app-server-sdk/config";
import { WebCryptoHmacSigner } from "shopware-app-server-sdk/component/signer";
import { convertRequest, convertResponse, CloudflareShopRepository } from "shopware-app-server-sdk/runtime/cf-worker";
import { HttpClient } from "shopware-app-server-sdk/component/http-client";
import XMLBuilder from "./utils/xml";
import { getShopByAuth } from "./utils/auth";
import { Folder, getFolderTree } from "./utils/tree";
import { HTTPCode } from "./utils/enum";
import { extractFileName, resolveRoot as resolvePath } from "./utils/path";
import { getMedia, MediaEntity } from "./utils/api";
import { getCacheKey, hasCacheKey, removeCacheKey, setCacheKey } from "./utils/cache";

const cfg: Config = {
    appName: 'FroshWebDav',
    appSecret: 'aClGgcSrikPWLI674NI3R84clyC7gyOS',
    authorizeCallbackUrl: 'https://froshwebdav.shyim.workers.dev/authorize/callback'
};

const clientCache: any  = [];

export async function handleRequest(request: Request): Promise<Response> {
    // deliver options fast as possible
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Allow': 'OPTIONS, DELETE, COPY, MOVE, PROPFIND',
                'Ms-Author-Via': 'DAV',
                'DAV': '1, 2',
            }
        });
    }

    const url = new URL(request.url);

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

    // We don't store OS specific files. Stop them to reach our backend
    if (url.pathname.endsWith('/desktop.ini') || url.pathname.endsWith('/.DS_Store') || url.pathname.endsWith('/Thumbs.db')) {
        return new Response('', {
            status: HTTPCode.NotFound,
        });
    }

    // We don't support it, but some stupid clients like Windows Explorer still does it
    if (request.method === 'LOCK') {
        return new Response(`<?xml version="1.0" encoding="utf-8"?>
        <D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>
            <D:locktype><D:write/></D:locktype>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:depth>infinity</D:depth>
            <D:owner><D:href>client</D:href></D:owner>
            <D:timeout>Second-3600</D:timeout>
            <D:locktoken><D:href>1647962846</D:href></D:locktoken>
            <D:lockroot><D:href>/00f1628adad3b4d284f5ed009ddccbdd.jpg</D:href></D:lockroot>
        </D:activelock></D:lockdiscovery></D:prop>`, {
            status: HTTPCode.OK,
            headers: {
                'Lock-Token': '<1647962846>'
            }
        });
    }

    if (request.method === 'UNLOCK') {
        return new Response(null, {
            status: HTTPCode.NoContent,
        })
    }

    if (request.method === 'PROPPATCH') {
        return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${url.pathname}</D:href><D:propstat><D:prop><Win32CreationTime xmlns="urn:schemas-microsoft-com:"></Win32CreationTime><Win32LastAccessTime xmlns="urn:schemas-microsoft-com:"></Win32LastAccessTime><Win32LastModifiedTime xmlns="urn:schemas-microsoft-com:"></Win32LastModifiedTime><Win32FileAttributes xmlns="urn:schemas-microsoft-com:"></Win32FileAttributes></D:prop><D:status>HTTP/1.1 403 Forbidden</D:status></D:propstat></D:response></D:multistatus>`,
            {
                status: HTTPCode.MultiStatus,
            } 
        )
    }

    const shop = await getShopByAuth(request, app.repository);

    if (shop === null) {
        return new Response("cannot find shop by credentials", {
            status: HTTPCode.Unauthorized,
            headers: {
                'WWW-Authenticate': 'Basic realm="WebDav"'
            }
        });
    }

    let client : HttpClient;
    if (typeof clientCache[shop.id] !== 'undefined') {
        client = clientCache[shop.id] as HttpClient;
    } else {
        client = clientCache[shop.id] = new HttpClient(shop);
    }

    let response = new Response(null, {
        status: HTTPCode.MethodNotAllowed,
    });

    if (request.method === 'PROPFIND') {
        let {root, itenName} = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        const depth = parseInt(request.headers.get('depth') || '1');

        const builder = new XMLBuilder('D:multistatus', {
            'xmlns:D': 'DAV:',
        });

        // Requested find is a folder
        if (itenName === '' || root.findFolder(itenName)) {
            if (root.findFolder(itenName)) {
                root = root.findFolder(itenName) as Folder;
            }

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
                    if (result.fileName === null) {
                        continue;
                    }

                    builder.add(buildFile(root, result));
                }
            }
        } else {
            let media : MediaEntity|null = null;

            if (extractFileName(itenName).fileName === '') {
                return new Response('', {status: HTTPCode.NotFound});
            }

            if (hasCacheKey(shop.id, itenName)) {
                media = getCacheKey(shop.id, itenName);

                //removeCacheKey(shop.id, itenName);
            } else {
                media = await getMedia(client, root.id, itenName);
            }

            if (media == null) {
                return new Response('', {status: HTTPCode.NotFound});
            }

            builder.add(buildFile(root, media));
        }

        return new Response(builder.build(), {
            status: HTTPCode.MultiStatus,
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
        const {root, itenName} = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        let media : MediaEntity|null = null;

        if (hasCacheKey(shop.id, itenName)) {
            media = getCacheKey(shop.id, itenName);

            removeCacheKey(shop.id, itenName);
        } else {
            media = await getMedia(client, root.id, itenName);
        }

        if (media === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        if (request.method === 'GET') {
            if (media.url === 'dummy') {
                return new Response('');
            }

            return await fetch(media.url, {
                headers: {
                    Range: request.headers.get('Range') || ''
                }
            })
        } else {
            return new Response('', {
                status: HTTPCode.OK,
                headers: {
                    'content-length': media.fileSize.toString()
                }
            })
        }
    }

    if (request.method === 'MKCOL') {
        const {root, itenName} = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        if (root.findFolder(itenName) !== null) {
            return new Response('', {status: HTTPCode.Conflict});
        }

        await client.post('/media-folder', {
            parentId: root.id,
            name: itenName,
            configuration: {
                private: false
            }
        });

        return new Response('', {
            status: HTTPCode.Created,
        });
    }

    if (request.method === 'DELETE') {
        const {root, itenName} = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        if (root.findFolder(itenName)) {
            await client.delete(`/media-folder/${root.findFolder(itenName)?.id}`);

            // Delete all files in that folder and recursive
        } else {
            const media = await getMedia(client, root.id, itenName);

            if (media === null) {
                return new Response('cannot find file by name', {
                    status: HTTPCode.NotFound,
                });
            }

            try {
                await client.delete(`/media/${media.id}`);
            } catch (e: any) {
                if (typeof e.response !== 'undefined') {
                    if (e.response?.body?.errors[0]?.detail.indexOf('An exception occurred while executing') !== -1) {
                        // that media is locked somehow
                        return new Response(e.response?.body?.errors[0]?.detail, {
                            status: HTTPCode.Locked,
                        })
                    }
                }
            }
        }

        return new Response(null, {
            status: HTTPCode.NoContent,
        });
    }

    if (request.method === 'PUT') {
        const {root, itenName} = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        const {fileName, fileExtension} = extractFileName(itenName);

        // The webdav client wants to create a empty file and later write here again.
        // We can't create a file at the remote with an empty body
        if (request.headers.get('content-length')?.toString() === '0') {
            setCacheKey(shop.id, itenName, {
                id: 'dummy',
                fileName,
                fileExtension,
                uploadedAt: 'Tue, 22 Mar 2022 15:27:14 GMT',
                mimeType: 'text/plain',
                url: 'dummy',
                fileSize: 0,
            });

            return new Response('', {status: HTTPCode.Created});
        }

        removeCacheKey(shop.id, itenName);

        const newMediaElement = await client.post('/media?_response=true', {
            mediaFolderId: root.id,
        });

        const search = new URLSearchParams();
        search.set('fileName', fileName);
        search.set('extension', fileExtension);

        const resp = await fetch(`${shop.shopUrl}/api/_action/media/${newMediaElement.body.data.id}/upload?${search.toString()}`, {
            body: request.body,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${await client.getToken()}`,
                Accept: 'application/json',
            }
        });

        if (!resp.ok) {
            // Cleanup empty media item
            try {
                await client.delete(`/media/${newMediaElement.body.data.id}`);
            } catch (e){}

            return new Response('conflict', {
                status: HTTPCode.BadRequest,
            })
        }

        return new Response('', {status: HTTPCode.Created});
    }

    if (request.method === 'MOVE') {
        const targetUrl = new URL(request.headers.get('Destination') as string);

        let {root, itenName} = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', {status: HTTPCode.NotFound});
        }

        // Source is a folder
        if (root.findFolder(itenName)) {
            const folder = root.findFolder(itenName) as Folder;
            let {root: targetRoot, itenName: targetName} = await resolvePath(targetUrl.pathname, client);

            await client.put(`/media-folder/${folder.id}`, {
                parentId: targetRoot?.id,
                name: targetName
            });
            
        }

        return new Response('', {status: HTTPCode.Created});
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
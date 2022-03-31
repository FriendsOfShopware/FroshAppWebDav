import { App } from "shopware-app-server-sdk";
import { Config } from "shopware-app-server-sdk/config";
import { WebCryptoHmacSigner } from "shopware-app-server-sdk/component/signer";
import { convertRequest, convertResponse, CloudflareShopRepository } from "shopware-app-server-sdk/runtime/cf-worker";
import { HttpClient } from "shopware-app-server-sdk/component/http-client";
import XMLBuilder from "./utils/xml";
import { getShopByAuth } from "./utils/auth";
import { Folder } from "./utils/tree";
import { HTTPCode } from "./utils/enum";
import { extractFileName, resolveRoot as resolvePath, resolveRootOnFolder } from "./utils/path";
import { getMedia, MediaEntity } from "./utils/api";
import { getCacheKey, hasCacheKey, removeCacheKey, setCacheKey } from "./utils/cache";
import { Shop } from "shopware-app-server-sdk/shop";
import { generateRandomString } from "./utils/random";

const cfg: Config = {
    appName: 'FroshAppWebDav',
// @ts-ignore
    appSecret: globalThis.APP_SECRET || 'aClGgcSrikPWLI674NI3R84clyC7gyOS',
    authorizeCallbackUrl: 'https://webdav.fos.gg/authorize/callback'
};

const clientCache: any = [];

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

        const successHandler = async (shop: Shop) => {
            shop.customFields.password = generateRandomString(16);
            shop.customFields.active = false;
        };

        return await convertResponse(await app.registration.authorizeCallback(req, successHandler));
    }

    if (url.pathname.startsWith('/authorize')) {
        const req = await convertRequest(request);
        return await convertResponse(await app.registration.authorize(req));
    }

    if (url.pathname.startsWith('/hook/deleted')) {
        const req = await convertRequest(request);
        let source = null;

        // When the message queue is broken, we get requests about already uninstalled shops. Ignore it
        try {
            source = await app.contextResolver.fromSource(req);
        } catch (e) {}

        if (source) {
            await app.repository.deleteShop(source.shop);
        }

        return new Response(null, { status: HTTPCode.NoContent });
    }

    if (url.pathname.startsWith('/hook/activated') || url.pathname.startsWith('/hook/deactivated')) {
        return new Response(null, { status: HTTPCode.NoContent });
    }

    if (url.pathname.startsWith('/module/webdavConfig')) {
        const req = await convertRequest(request);
        const ctx = await app.contextResolver.fromModule(req);

        return new Response(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-1BmE4kWBq78iYhFldvKuhfTAU6auU8tT94WrHftjDbrCEXSU1oBoqyl2QvZ6jIW3" crossorigin="anonymous">
</head>
<body>
    <div class="container">
        <div class="card mb-4 mt-4">
            <div class="card-body">
                <h5 class="card-title">Why WebDav?</h5>

                <p class="card-text">
                    WebDav lets you serve your Shopware Media Manager in your Operating System just like any other shared drive. Manage your files easily without going into the Shop administration, or handover the credentials to your designer and let him upload the files easily.

                    <div class="alert alert-info" role="alert">
                        This is a free service please don't abuse it.
                    </div>
                </p>
            </div>
        </div>

        <div class="card mb-4">
            <div class="card-body">
                <h5 class="card-title">My Credentials</h5>
                <p class="card-text">
                    <div><strong>Server:</strong> https://webdav.fos.gg</div>
                    <div><strong>User:</strong> ${ctx.shop.id}</div>
                    <div class="mb-1"><strong>Password:</strong> ${ctx.shop.customFields.password}</div>

                    <div class="alert alert-info" role="alert">
                        The password is auto generated. If you want to reset it, just reinstall the app.
                    </div>
                </p>
            </div>
        </div>

        <div class="card mb-4">
            <div class="card-body">
                <h5 class="card-title">Known Shopware limitations</h5>
                <p class="card-text">
                    <ul class="list-group list-group-flush">
                        <li class="list-group-item">The file size is limited to your Shopware hosting settings</li>
                        <li class="list-group-item">A file name can be only used once between all folders</li>
                        <li class="list-group-item">Only following file types are supported: jpg, jpeg, png, webp, gif, svg, bmp, tiff, tif, eps, webm, mkv, flv, ogv, ogg, mov, mp4, avi, wmv, pdf, aac, mp3, wav, flac, oga, wma, txt, doc, ico</li>
                    </ul>
                </p>
            </div>
        </div>
    </div>
    

    <script>
    window.parent.postMessage('sw-app-loaded', '*');
    </script>
</body>
`, {
            headers: {
                "content-type": 'text/html',
            }
        });
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

    //const shop = await app.repository.getShopById('66nXHnfQ8hgvb31O');
    const shop = await getShopByAuth(request, app.repository);

    if (shop === null) {
        return new Response("cannot find shop by credentials", {
            status: HTTPCode.Unauthorized,
            headers: {
                'WWW-Authenticate': 'Basic realm="WebDav"'
            }
        });
    }

    let client: HttpClient;
    if (typeof clientCache[shop.id] !== 'undefined') {
        client = clientCache[shop.id] as HttpClient;
    } else {
        client = clientCache[shop.id] = new HttpClient(shop);
    }

    let response = new Response(null, {
        status: HTTPCode.MethodNotAllowed,
    });

    if (request.method === 'PROPFIND') {
        let { root, itenName } = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', { status: HTTPCode.NotFound });
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
            let media: MediaEntity | null = null;

            if (extractFileName(itenName).fileName === '') {
                return new Response('', { status: HTTPCode.NotFound });
            }

            if (hasCacheKey(shop.id, itenName)) {
                media = getCacheKey(shop.id, itenName);
            } else {
                media = await getMedia(client, root.id, itenName);
            }

            if (media == null) {
                return new Response('', { status: HTTPCode.NotFound });
            }

            builder.add(buildFile(root, media));
        }

        return new Response(builder.build(), {
            status: HTTPCode.MultiStatus,
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
        const { root, itenName } = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', { status: HTTPCode.NotFound });
        } else if (itenName === '') {
            return new Response('', { status: HTTPCode.OK });
        }

        let media: MediaEntity | null = null;

        if (hasCacheKey(shop.id, itenName)) {
            media = getCacheKey(shop.id, itenName);

            removeCacheKey(shop.id, itenName);
        } else if (itenName.length) {
            if (extractFileName(itenName).fileName === '') {
                return new Response('', { status: HTTPCode.NotFound });
            }

            media = await getMedia(client, root.id, itenName);
        }

        if (media === null) {
            return new Response('', { status: HTTPCode.NotFound });
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
        const { root, itenName } = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', { status: HTTPCode.NotFound });
        }

        if (root.findFolder(itenName) !== null) {
            return new Response('', { status: HTTPCode.Conflict });
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
        const { root, itenName } = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', { status: HTTPCode.NotFound });
        }

        if (root.findFolder(itenName)) {
            const folder = root.findFolder(itenName) as Folder;

            const mediaElements = await client.post('/search-ids/media', {
                filter: [
                    {
                        'type': 'equalsAny',
                        'field': 'mediaFolderId',
                        'value': [folder.id, ...folder.getChildrenIds()]
                    }
                ]
            });

            if (mediaElements.body.total > 0) {
                return new Response('folder is not empty', {
                    status: HTTPCode.Conflict,
                })
            }

            await client.delete(`/media-folder/${root.findFolder(itenName)?.id}`);
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
        const { root, itenName } = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', { status: HTTPCode.NotFound });
        }

        const { fileName, fileExtension } = extractFileName(itenName);

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

            return new Response('', { status: HTTPCode.Created });
        }

        removeCacheKey(shop.id, itenName);

        let media = await getMedia(client, root.id, itenName);

        if (media === null) {
            const newMediaElement = await client.post('/media?_response=true', {
                mediaFolderId: root.id,
            });

            media = newMediaElement.body.data as MediaEntity
        }

        const search = new URLSearchParams();
        search.set('fileName', fileName);
        search.set('extension', fileExtension);

        const resp = await fetch(`${shop.shopUrl}/api/_action/media/${media.id}/upload?${search.toString()}`, {
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
                await client.delete(`/media/${media.id}`);
            } catch (e) { }

            return new Response('conflict', {
                status: HTTPCode.BadRequest,
            })
        }

        return new Response('', { status: HTTPCode.Created });
    }

    if (request.method === 'MOVE') {
        const targetUrl = new URL(request.headers.get('Destination') as string);

        let { root, itenName } = await resolvePath(url.pathname, client);

        if (root === null) {
            return new Response('', { status: HTTPCode.NotFound });
        }

        // Source is a folder
        if (root.findFolder(itenName)) {
            const folder = root.findFolder(itenName) as Folder;
            let { root: targetRoot, itenName: targetName } = resolveRootOnFolder(targetUrl.pathname, root.getRoot());

            await client.patch(`/media-folder/${folder.id}`, {
                parentId: targetRoot?.id,
                name: targetName
            });
        } else {
            const media = await getMedia(client, root.id, itenName);

            if (media === null) {
                return new Response('', { status: HTTPCode.NotFound });
            }

            let { root: targetRoot, itenName: targetName } = resolveRootOnFolder(targetUrl.pathname, root.getRoot());

            // Update folder if moved
            if (targetRoot!!.id !== root.id) {
                await client.patch(`/media/${media.id}`, {
                    mediaFolderId: targetRoot!!.id
                });
            }

            // Update filename when changed
            if (itenName !== targetName) {
                const { fileExtension: sourceExtension } = extractFileName(targetName);
                const { fileName: newName, fileExtension: targetExtension } = extractFileName(targetName);

                if (targetExtension !== sourceExtension) {
                    return new Response('conflict', {
                        status: HTTPCode.BadRequest,
                    })
                }

                await client.post(`/_action/media/${media.id}/rename`, {
                    fileName: newName
                });
            }
        }

        return new Response('', { status: HTTPCode.Created });
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
    resourceType.elem('D:collection', undefined, { 'xmlns:D': 'DAV:' })

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

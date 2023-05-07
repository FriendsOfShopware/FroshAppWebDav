import { HttpClient } from '@friendsofshopware/app-server-sdk'
import { Folder, getFolderTree } from './tree'

export async function resolveRoot(path: string, client: HttpClient) {
    let root: Folder | null = await getFolderTree(client)

    return resolveRootOnFolder(path, root)
}

export function resolveRootOnFolder(path: string, folder: Folder) {
    let root: Folder | null = folder

    path = path.substring(1)

    if (path.endsWith('/')) {
        path = path.substring(0, path.length - 1)
    }

    const parts = path.split('/').map((part) => decodeURIComponent(part))

    const itenName = parts.pop() as string

    if (parts.length) {
        root = root.findFolderByPath(parts)
    }

    return {
        root,
        itenName,
    }
}

export function extractFileName(itenName: string) {
    const fileSplits = itenName.split('.')
    const fileExtension = fileSplits.pop()
    const fileName = fileSplits.join('.')

    return { fileName, fileExtension: fileExtension as string }
}

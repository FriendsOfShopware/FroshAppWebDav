import { HttpClient } from "shopware-app-server-sdk/component/http-client";
import { Folder, getFolderTree } from "./tree";

export async function resolveRoot(path: string, client: HttpClient) {
    path = path.substring(1);
    
    if (path.endsWith('/')) {
        path = path.substring(0, path.length - 1);
    }

    const parts = path.split('/').map(part => decodeURIComponent(part));

    const itenName = (parts.pop() as string);

    let root: Folder|null = await getFolderTree(client);

    if (parts.length) {
        root = root.findFolderByPath(parts);
    }

    return {
        root,
        itenName
    }
}

export function extractFileName(itenName: string) {
    const fileSplits = itenName.split('.');
    const fileExtension = fileSplits.pop();
    const fileName = fileSplits.join('.');

    return {fileName, fileExtension: fileExtension as string};
}
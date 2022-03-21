import { HttpClient } from "shopware-app-server-sdk/component/http-client";

export class Folder {
    public id: string | null;
    public name: string;
    public parentId: string | null;
    public createdAt: string;
    public children: Folder[];
    public parent: Folder|null;

    constructor(id: string|null, name: string, parentId: string | null, createdAt: string, children: Folder[] = []) {
        this.id = id;
        this.name = name;
        this.parentId = parentId;
        this.createdAt = createdAt;
        this.children = children;
        this.parent = null;
    }

    findFolderByPath(parts: string[]): Folder|null {
        let cur : Folder|null = this;

        while(parts.length) {
            const part = parts.shift();

            if (part === undefined) {
                return null;
            }

            cur = cur.findFolder(part);

            if (cur === null) {
                return null;
            }
        }

        return cur;
    }

    findFolder(name: string): Folder|null {
        for (const child of this.children) {
            if (child.name === name) {
                return child;
            }
        }

        return null;
    }

    getPath(): string {
        if (this.id === null) {
            return '/';
        }

        let cur = this.parent;
        let path = '';

        while (cur != null) {
            path = `/${encodeURIComponent(cur.name)}${path}`;
            cur = cur.parent;
        }

        return `${path}/${encodeURIComponent(this.name)}/`;
    }
}

export async function getFolderTree(client: HttpClient): Promise<Folder>
{
    const mediaFolderResult = await client.post('/search/media-folder', {
        includes: {
            media_folder: ['id', 'name', 'parentId', 'createdAt'],
        }
    });

    const root = new Folder(null, '', null, '', []);

    let children: Folder[] = [];

    // Convert all to Folder type
    for (const serverFolder of mediaFolderResult.body.data) {
        children.push(new Folder(serverFolder.id, serverFolder.name, serverFolder.parentId, serverFolder.createdAt))
    }

    // Assign the childrens
    for (const child of children) {
        for (const otherChild of children) {
            if (otherChild.parentId === child.id) {
                child.children.push(otherChild);
                otherChild.parent = child;
            }
        }
    }

    // Strip all non parentId to root
    root.children = children.filter((child) => {
        return child.parentId === null;
    });

    return root;
}

let a = new Folder('a', 'a', null, 'a');
let b = new Folder('b', 'b', null, 'b');
let c = new Folder('c', 'c', null, 'c');
c.parent = b;
b.parent = a;

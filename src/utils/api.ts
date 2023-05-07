import { HttpClient } from '@friendsofshopware/app-server-sdk'
import { extractFileName } from './path'

export interface MediaEntity {
    id: string
    url: string
    fileSize: number
}

export async function getMedia(client: HttpClient, folderId: string | null, itenName: string): Promise<MediaEntity | null> {
    const { fileExtension, fileName } = extractFileName(itenName)

    const result = await client.post('/search/media', {
        filter: [
            {
                type: 'multi',
                operator: 'and',
                queries: [
                    {
                        type: 'equals',
                        field: 'mediaFolderId',
                        value: folderId,
                    },
                    {
                        type: 'equals',
                        field: 'fileName',
                        value: fileName,
                    },
                    {
                        type: 'equals',
                        field: 'fileExtension',
                        value: fileExtension,
                    },
                ],
            },
        ],
    })

    if (result.body.total === 0) {
        return null
    }

    return result.body.data[0] as MediaEntity
}

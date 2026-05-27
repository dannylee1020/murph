export async function getJson<T>(path: string): Promise<T> {
    const response = await fetch(path);
    const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
    };
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed: ${path}`,
            response.status,
            payload,
        );
    }
    return payload;
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
    };
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed: ${path}`,
            response.status,
            payload,
        );
    }
    return payload;
}

export class ApiError<TPayload = unknown> extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly payload: TPayload,
    ) {
        super(message);
    }
}

export async function putJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
        method: 'PUT',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
    };
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed: ${path}`,
            response.status,
            payload,
        );
    }
    return payload;
}

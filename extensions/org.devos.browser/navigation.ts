export function browserUri(input: string): string {
    const value = input.trim();
    if (!value) return 'https://duckduckgo.com/';
    if (/^https?:\/\//i.test(value)) return value;
    if (!/\s/.test(value) && /^(?:localhost|[\w-]+(?:\.[\w-]+)+|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(value)) return `https://${value}`;
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

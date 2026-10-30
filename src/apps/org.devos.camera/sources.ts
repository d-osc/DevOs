/** Speaker loopback inputs are not microphones, even if advertised Audio/Source. */
export function isMicrophoneSource(properties: {deviceClass?: string | null; deviceName?: string | null; nodeName?: string | null}): boolean {
    return properties.deviceClass !== 'monitor' &&
        ![properties.deviceName, properties.nodeName].some(name => name?.endsWith('.monitor'));
}

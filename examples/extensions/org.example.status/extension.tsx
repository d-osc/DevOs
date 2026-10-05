import {
    React, Box, Label, Button, useState,
    type UIExtension
} from '@dev-os/core';

export default {id: 'org.example.status', activate(context) {
    context.registerSettingsPage?.('org.example.status', function StatusPage() {
        const [count, setCount] = useState(0);
        return <Box className="settings-content" orientation="vertical" spacing={16} borderWidth={24} expand>
        <Label className="heading" xalign={0}>Workspace Status</Label>
        <Label xalign={0} wrap>Installed from a GitHub release. This page uses the desktop's shared React GTK runtime.</Label>
        <Label id="status-counter" xalign={0}>{`Count: ${count}`}</Label>
        <Button id="status-increment" onClicked={() => setCount(value => value + 1)}>Test React hooks</Button>
    </Box>;
    });
    return () => {};
}} satisfies UIExtension;

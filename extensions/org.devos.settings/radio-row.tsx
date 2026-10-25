import {React, Box, Label, Image, Button} from '@dev-os/core';
/** One choice of a MyASUS-style radio list: radio icon, title and description inside a `power-mode` button. */
export function RadioRow({id, selected, sensitive, title, description, onClicked}: {id: string; selected: boolean; sensitive: boolean; title: string; description: string; onClicked: () => void}) {
    return <Button id={id} className={`power-mode ${selected ? 'power-mode-selected' : ''}`} sensitive={sensitive} onClicked={onClicked}>
        <Box spacing={14}><Image iconName={selected ? 'radio-checked-symbolic' : 'radio-symbolic'} pixelSize={18} /><Box orientation="vertical" spacing={3} expand><Label className="settings-field-title" xalign={0}>{title}</Label><Label className="settings-description" xalign={0} wrap>{description}</Label></Box></Box>
    </Button>;
}

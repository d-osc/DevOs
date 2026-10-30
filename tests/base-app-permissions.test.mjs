import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let authorize;
vm.runInNewContext(fs.readFileSync(new URL('../data/polkit-1/rules.d/46-devos-base-apps.rules', import.meta.url), 'utf8'), {
    polkit: {Result: {YES: 'yes', NOT_HANDLED: 'continue'}, addRule(rule) {authorize = rule;}}
});
const admin = {local: true, active: true, user: 'admin', isInGroup: group => group === 'wheel'};
const request = (id, program = '') => ({id, lookup: key => key === 'program' ? program : undefined});
for (const file of fs.readdirSync(new URL('../data/polkit-1/actions/', import.meta.url))) {
    const xml = fs.readFileSync(new URL(`../data/polkit-1/actions/${file}`, import.meta.url), 'utf8');
    for (const match of xml.matchAll(/<action id="([^"]+)"[^>]*>([\s\S]*?)<\/action>/g)) {
        if (match[1] === 'org.devos.accounts.setup') continue;
        const helper = match[2].match(/exec.path">([^<]+)</)[1];
        assert.equal(authorize(request(match[1], helper), admin), 'yes', match[1]);
        assert.equal(authorize(request(match[1], '/bin/sh'), admin), 'continue');
        assert.equal(authorize(request(match[1], helper), {...admin, active: false}), 'continue');
        assert.equal(authorize(request(match[1], helper), {...admin, isInGroup: () => false}), 'continue');
    }
}
for (const id of ['org.freedesktop.udisks2.filesystem-mount-system', 'org.freedesktop.login1.reboot', 'org.freedesktop.hostname1.set-hostname', 'org.freedesktop.NetworkManager.network-control']) {
    assert.equal(authorize(request(id), admin), 'yes');
    assert.equal(authorize(request(id), {...admin, local: false}), 'continue');
}
for (const id of ['org.freedesktop.policykit.exec', 'org.freedesktop.systemd1.manage-units', 'org.devos.unknown', 'org.freedesktop.udisks2evil'])
    assert.equal(authorize(request(id, '/bin/sh'), admin), 'continue');
console.log('PASS: all built-in admin helpers and system controls; pinned helper paths; no arbitrary root execution, inactive, remote or non-admin grants');

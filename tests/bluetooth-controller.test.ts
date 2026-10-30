import {Bluetooth} from '../src/apps/org.devos.settings/bluetooth.js';
function assert(value: unknown, message: string) {if (!value) throw new Error(message);}
let scanned = '';
const controller = new Bluetooth({scan: async (adapter, read) => {scanned=adapter;return read();},destroy:()=>{}});
const calls: Record<string, unknown>[] = [];
const adapter = {id:'/org/bluez/hci0',name:'QCC2072',powered:true};
const device = {id:'/org/bluez/hci0/dev_AA',adapter:adapter.id,name:'Headphones',address:'AA',icon:'',paired:true,connected:false};
// Transport fixture uses the CLI's actual {ok,state} envelope, including after mutations.
(controller as unknown as {request: (payload: Record<string, unknown>) => Promise<unknown>}).request = async payload => {
    calls.push(payload);
    return {ok:true,state:{adapters:[adapter],devices:[device],usb:[],inputs:[],bluetoothError:''}};
};
await controller.refresh();
assert(calls[0].action === 'get', 'Refresh must use the helper get action');
assert(!controller.state.error && controller.state.adapters[0]?.id === adapter.id, 'Read adapter from nested state');
await controller.refresh(true);
assert(scanned === adapter.id && calls[1].action === 'get' && controller.state.devices[0]?.id === device.id, 'Read devices while persistent discovery is active');
await controller.power(adapter);
assert(calls[2].powered === false && !controller.state.error, 'Power response uses the same envelope');
await controller.device('connect',device);
assert(calls[3].action === 'connect' && !controller.state.error, 'Connect response uses the same envelope');
controller.destroy();
print('PASS: Bluetooth controller get/scan/power/connect CLI protocol');

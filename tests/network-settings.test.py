"""Network settings against a private NetworkManager service, never host devices."""
import json
import subprocess
import threading
import unittest
from gi.repository import Gio, GLib
from devlang_support import run_source, run_bin, use

BASE='/org/freedesktop/NetworkManager'
DEVICE=BASE+'/Devices/1'; SAVED=BASE+'/Settings/1'; ACTIVE=BASE+'/ActiveConnection/1'; IP=BASE+'/IP4Config/1'; IP6=BASE+'/IP6Config/1'
ID='11111111-1111-1111-1111-111111111111'
V=GLib.Variant
PROPERTIES='<node><interface name="org.freedesktop.DBus.Properties"><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method><method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method></interface></node>'
NM='<node><interface name="org.freedesktop.NetworkManager"><method name="GetDevices"><arg type="ao" direction="out"/></method><method name="AddAndActivateConnection"><arg type="a{sa{sv}}" direction="in"/><arg type="o" direction="in"/><arg type="o" direction="in"/><arg type="o" direction="out"/><arg type="o" direction="out"/></method><method name="DeactivateConnection"><arg type="o" direction="in"/></method><method name="CheckConnectivity"><arg type="u" direction="out"/></method></interface></node>'
LIST='<node><interface name="org.freedesktop.NetworkManager.Settings"><method name="ListConnections"><arg type="ao" direction="out"/></method></interface></node>'
CONNECTION='<node><interface name="org.freedesktop.NetworkManager.Settings.Connection"><method name="GetSettings"><arg type="a{sa{sv}}" direction="out"/></method><method name="Delete"/></interface></node>'
DISCONNECT='<node><interface name="org.freedesktop.NetworkManager.Device"><method name="Disconnect"/></interface></node>'

class NetworkSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.daemon=subprocess.Popen(['dbus-daemon','--session','--nofork','--print-address=1'],stdout=subprocess.PIPE,text=True)
        cls.address=cls.daemon.stdout.readline().strip()
        cls.bus=Gio.DBusConnection.new_for_address_sync(cls.address,Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT|Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,None,None)
        cls.bus.call_sync('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','RequestName',V('(su)',('org.freedesktop.NetworkManager',0)),None,Gio.DBusCallFlags.NONE,-1,None)
        cls.registrations=[]
        for path,xmls in [(BASE,[PROPERTIES,NM]),(BASE+'/Settings',[LIST]),(DEVICE,[PROPERTIES,DISCONNECT]),(SAVED,[CONNECTION]),(ACTIVE,[PROPERTIES]),(IP,[PROPERTIES]),(IP6,[PROPERTIES])]:
            for xml in xmls: cls.registrations.append(cls.bus.register_object(path,Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0],cls.call,None,None))
        cls.loop=GLib.MainLoop(); cls.thread=threading.Thread(target=cls.loop.run,daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.loop.quit(); cls.thread.join(3)
        for registration in cls.registrations: cls.bus.unregister_object(registration)
        cls.bus.close_sync(None); cls.daemon.terminate(); cls.daemon.wait(timeout=5); cls.daemon.stdout.close()

    def setUp(self):
        type(self).calls=[]; type(self).active=False; type(self).hotspot=False; type(self).activation=2; type(self).capable=True; type(self).activation_error=''; type(self).vanish=False

    @classmethod
    def props(cls,path,interface):
        if path==BASE: return {'ActiveConnections':V('ao',[ACTIVE] if cls.active else []),'Connectivity':V('u',4)}
        if path==DEVICE and interface.endswith('.Wireless'): return {'WirelessCapabilities':V('u',0x40 if cls.capable else 0)}
        if path==DEVICE: return {'DeviceType':V('u',2),'Interface':V('s','wlan-test'),'State':V('u',100),'Managed':V('b',True),'Mtu':V('u',1500),'HwAddress':V('s','12:34:56:78:90:ab'),'Driver':V('s','fixture'),'Ip4Config':V('o',IP),'Ip6Config':V('o',IP6),'StateReason':V('(uu)',(120,19))}
        if path==IP: return {'AddressData':V('aa{sv}',[{'address':V('s','192.0.2.10'),'prefix':V('u',24)}]),'NameserverData':V('aa{sv}',[{'address':V('s','192.0.2.1')}]),'Gateway':V('s','192.0.2.1')}
        if path==IP6: return {'AddressData':V('aa{sv}',[]),'Nameservers':V('aay',[[0x20,1,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,0x53]]),'Gateway':V('s','')}
        if path==ACTIVE: return {'Uuid':V('s',ID),'State':V('u',cls.activation)}
        raise ValueError(path)

    @classmethod
    def call(cls,connection,sender,path,interface,method,parameters,invocation):
        args=parameters.unpack(); cls.calls.append((method,args))
        if path==ACTIVE and cls.vanish:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownMethod','Object does not exist'); return
        try:
            if method=='GetAll': invocation.return_value(V('(a{sv})',(cls.props(path,args[0]),)))
            elif method=='Get': invocation.return_value(V('(v)',(cls.props(path,args[0])[args[1]],)))
            elif method=='GetDevices': invocation.return_value(V('(ao)',([DEVICE],)))
            elif method=='ListConnections': invocation.return_value(V('(ao)',([SAVED],)))
            elif method=='GetSettings':
                settings={'connection':{'uuid':V('s',ID),'id':V('s','Fixture VPN'),'type':V('s','802-11-wireless' if cls.hotspot else 'wireguard'),'stable-id':V('s','devos-hotspot-v1' if cls.hotspot else '')},'802-11-wireless':{'mode':V('s','ap' if cls.hotspot else 'infrastructure')},'wireguard':{'private-key':V('s','NEVER-RETURN-SECRET')}}
                invocation.return_value(V('(a{sa{sv}})',(settings,)))
            elif method=='AddAndActivateConnection':
                if cls.activation_error: invocation.return_dbus_error('org.freedesktop.NetworkManager.Settings.InvalidConnection',cls.activation_error)
                else: cls.active=True; cls.hotspot=True; invocation.return_value(V('(oo)',(SAVED,ACTIVE)))
            elif method=='DeactivateConnection': cls.active=False; invocation.return_value(V('()',()))
            elif method=='CheckConnectivity': invocation.return_value(V('(u)',(4,)))
            else: invocation.return_value(V('()',()))
        except Exception as error: invocation.return_dbus_error('org.devos.Test.Error',str(error))

    def execute(self,request):
        source=use('network-settings','network')+use('dbus')+'use "std/json"\nuse "std/result"\nlet bus=dbus.open()\nlet outcome=result.attempt(fn(): json.Value { return network.execute(bus,json.parse('+json.dumps(json.dumps(request))+')) })\ndbus.close(bus)\nif result.isErr(outcome) { print(json.stringify({ok:false,error:result.message(outcome)})) } else { print(json.stringify(result.unwrap(outcome))) }'
        return json.loads(run_source(source,ffi=True,env={'DBUS_SYSTEM_BUS_ADDRESS':self.address}))

    def test_snapshot_real_properties_and_no_secrets(self):
        value=self.execute({'action':'list'}); self.assertTrue(value['ok'],value)
        self.assertEqual(value['adapters'][0]['ipv4']['addresses'],['192.0.2.10/24'])
        self.assertEqual(value['adapters'][0]['ipv4']['dns'],['192.0.2.1'])
        self.assertEqual(value['adapters'][0]['ipv6']['dns'],['2001:0db8:0000:0000:0000:0000:0000:0053'])
        self.assertNotIn('NEVER-RETURN-SECRET',json.dumps(value))
        self.assertEqual(value['profiles'][0]['id'],ID)

    def test_hotspot_private_psk_and_shared_ip_with_failure_cleanup(self):
        for activation in [2,4]:
            type(self).activation=activation; type(self).active=False; type(self).hotspot=False; type(self).calls=[]
            value=self.execute({'action':'hotspot-start','device':DEVICE,'ssid':'DevOs test','password':'test password'})
            self.assertEqual(value['ok'],activation==2,value)
            settings,device,point=next(args for method,args in self.calls if method=='AddAndActivateConnection')
            self.assertEqual(settings['802-11-wireless']['mode'],'ap')
            self.assertEqual(settings['ipv4']['method'],'shared')
            self.assertEqual(settings['802-11-wireless']['band'],'bg')
            self.assertFalse(settings['connection']['autoconnect'])
            self.assertEqual(settings['802-11-wireless-security']['psk'],'test password')
            self.assertEqual(settings['802-11-wireless-security']['proto'],['rsn'])
            self.assertEqual(settings['802-11-wireless-security']['pairwise'],['ccmp'])
            self.assertEqual(settings['802-11-wireless-security']['pmf'],1)
            self.assertNotIn('test password',json.dumps(value))
            if activation==4:
                self.assertIn('internet sharing could not start',value['error']); self.assertIn('code 19',value['error']); self.assertIn('devos-hotspot-report',value['error'])
                operations=[method for method,_ in self.calls]; self.assertIn('DeactivateConnection',operations); self.assertIn('Delete',operations)

    def test_hotspot_capability_and_password_validation_before_activation(self):
        for password in ['short','x'*64]:
            self.assertFalse(self.execute({'action':'hotspot-start','device':DEVICE,'ssid':'Test','password':password})['ok'])
        type(self).capable=False
        refused=self.execute({'action':'hotspot-start','device':DEVICE,'ssid':'Test','password':'valid password'})
        self.assertFalse(refused['ok'])
        self.assertIn('Hotspot is not supported by this Wi-Fi hardware/firmware',refused['error']); self.assertIn('fixture driver',refused['error'])
        self.assertNotIn('AddAndActivateConnection',[method for method,_ in self.calls])

    def test_native_error_reaches_worker_without_password(self):
        type(self).activation_error='AP rejected test-password by firmware'
        result=run_bin('network-settings',{'action':'hotspot-start','device':DEVICE,'ssid':'Test','password':'test-password'},env={'DBUS_SYSTEM_BUS_ADDRESS':self.address})
        value=json.loads(result.stdout)
        self.assertFalse(value['ok']); self.assertNotEqual(result.returncode,0)
        self.assertIn('AP rejected [redacted] by firmware',value['error'])
        self.assertNotIn('test-password',result.stdout+result.stderr)

    def test_activation_object_disappears_reports_device_reason_and_cleans_profile(self):
        type(self).vanish=True
        value=self.execute({'action':'hotspot-start','device':DEVICE,'ssid':'Test','password':'test-password'})
        self.assertFalse(value['ok']); self.assertIn('internet sharing could not start',value['error'])
        self.assertNotIn('UnknownMethod',value['error'])
        self.assertIn('Delete',[method for method,_ in self.calls])

    def test_validated_profile_and_device_actions(self):
        self.assertFalse(self.execute({'action':'vpn-remove','id':'invalid'})['ok'])
        self.assertFalse(self.execute({'action':'adapter-disconnect','device':'/wrong'})['ok'])
        self.assertTrue(self.execute({'action':'vpn-remove','id':ID})['ok'])
        self.assertTrue(self.execute({'action':'adapter-disconnect','device':DEVICE})['ok'])
        self.assertIn('Disconnect',[method for method,_ in self.calls])
        type(self).active=True
        self.assertFalse(self.execute({'action':'vpn-remove','id':ID})['ok'])
        self.assertTrue(self.execute({'action':'vpn-disconnect','id':ID})['ok'])

    def test_stop_only_deletes_owned_hotspot_and_real_entry_protocol(self):
        type(self).active=True; type(self).hotspot=True
        self.assertTrue(self.execute({'action':'hotspot-stop','id':ID})['ok'])
        self.assertIn('Delete',[method for method,_ in self.calls])
        result=run_bin('network-settings',{'action':'list'},env={'DBUS_SYSTEM_BUS_ADDRESS':self.address})
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])

if __name__=='__main__': unittest.main()

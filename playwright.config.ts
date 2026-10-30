import { defineConfig } from '@playwright/test';
const port=process.env.AFTERHOURS_TEST_PORT||'5207';
const url='http://127.0.0.1:'+port;
export default defineConfig({
  testDir:'./tests/browser',use:{baseURL:url},
  webServer:process.env.AFTERHOURS_TEST_EXTERNAL ? undefined : {command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port '+port+' --strictPort',url,reuseExistingServer:false,env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});

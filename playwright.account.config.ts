import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/account',
  use:{baseURL:'http://127.0.0.1:5227'},
  webServer:process.env.AFTERHOURS_TEST_EXTERNAL?undefined:{
    command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5227 --strictPort',
    url:'http://127.0.0.1:5227',reuseExistingServer:false,
    env:{VITE_SUPABASE_URL:'https://afterhours-test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'test-only'}
  },
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});

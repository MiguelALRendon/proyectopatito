import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/responsive.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { registerBuiltinProviders } from './documents/providers';

registerBuiltinProviders();
createApp(App).use(createPinia()).mount('#app');

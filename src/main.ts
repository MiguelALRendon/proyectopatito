import './styles/tokens.css';
import './styles/base.css';
import './styles/responsive.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

createApp(App).use(createPinia()).mount('#app');

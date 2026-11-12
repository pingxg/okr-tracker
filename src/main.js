import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createHead } from '@unhead/vue/client';
import {
  VueFire,
  VueFireAuthOptionsFromAuth,
  globalFirestoreOptions,
  firestoreDefaultConverter,
} from '@/backend/vuefire';
import VueTippy from 'vue-tippy';
import { ToastPlugin } from 'vue-toast-notification';
import '@oslokommune/punkt-elements/dist/pkt-icon.js';
import App from '@/App.vue';
import router from '@/router';
import i18n from '@/locale/i18n';
import PageLayout from '@/components/layout/PageLayout.vue';
import FormSection from '@/components/generic/form/FormSection.vue';
import FormComponent from '@/components/generic/form/FormComponent.vue';
import { waitForAuth } from '@/backend/auth';
import { auth } from './config/backend';
import configureFormValidation from './config/validation';

import 'vue-toast-notification/dist/theme-sugar.css';
import './styles/main.scss';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);

// Data bindings (VueFire-compatible API backed by the Node server)
app.use(VueFire, {
  modules: [VueFireAuthOptionsFromAuth({ auth })],
});

// Data binding global options (same semantics as VueFire's)
// https://vuefire.vuejs.org/guide/global-options.html
globalFirestoreOptions.maxRefDepth = 1;
globalFirestoreOptions.wait = true;
globalFirestoreOptions.reset = true;
globalFirestoreOptions.converter = {
  toFirestore: firestoreDefaultConverter.toFirestore,
  fromFirestore: (snapshot, options) => {
    const data = firestoreDefaultConverter.fromFirestore(snapshot, options);
    if (!data) {
      return null;
    }
    Object.defineProperty(data, 'path', {
      value: snapshot.ref.path,
      writable: false,
    });
    return data;
  },
};

// Unhead
// https://github.com/unjs/unhead
const head = createHead();
app.use(head);

// VueTippy
// https://vue-tippy.netlify.app/
app.use(VueTippy, {
  directive: 'tooltip',
  component: 'Tooltip',
  defaultProps: {
    maxWidth: 250,
    allowHTML: false,
  },
});

// Vue Toast Notification
// https://github.com/ankurk91/vue-toast-notification
// Note: Aliased to global property `$toasted` for backwards compatibility.
app.use(ToastPlugin, {
  duration: 3500,
});
const toasted = app.config.globalProperties.$toast;
toasted.show = toasted.success;
app.config.globalProperties.$toasted = toasted;

// Configure VeeValidate for form validation.
// https://vee-validate.logaretm.com/v4/guide/global-validators/
configureFormValidation();

// Global components
app.component('PageLayout', PageLayout);
app.component('FormSection', FormSection);
app.component('FormComponent', FormComponent);

// Start loading the session right away; the router guard waits for it.
waitForAuth();

app.mount('#app');

export default { app };

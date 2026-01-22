// Simple client-side router

export class Router {
  constructor({ routes, defaultRoute }) {
    this.routes = routes;
    this.defaultRoute = defaultRoute;
    this.currentView = null;
    this.listeners = new Set();
  }

  init() {
    // Handle initial route
    this.navigate(window.location.hash.slice(1) || this.defaultRoute);

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      this.navigate(window.location.hash.slice(1));
    });
  }

  navigate(path) {
    const route = this.routes.find(r => r.path === path);
    
    if (route) {
      this.currentView = route.view;
      window.location.hash = path;
    } else {
      // Fallback to default
      const defaultR = this.routes.find(r => r.path === this.defaultRoute);
      this.currentView = defaultR?.view || 'dashboard';
      window.location.hash = this.defaultRoute;
    }

    this.notify();
  }

  getView() {
    return this.currentView;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(listener => listener(this.currentView));
  }
}

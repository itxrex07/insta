export class BaseModule {
  constructor() {
    this.name = this.constructor.name.replace('Module', '').toLowerCase();
    this.commands = {};
    this.description = 'A Hyper Insta module';
  }

  // Override this method to define commands
  getCommands() {
    return this.commands;
  }

  // Override this method to process messages
  async process(message) {
    return message;
  }

  // Override this method for cleanup
  async cleanup() {
    // Cleanup logic here
  }

  // Helper method to register commands
  registerCommand(name, handler, description, usage, adminOnly = false) {
    this.commands[name] = {
      handler: handler.bind(this),
      description,
      usage,
      adminOnly
    };
  }
}
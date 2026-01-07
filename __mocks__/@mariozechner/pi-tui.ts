// Mock for @mariozechner/pi-tui

export class Text {
  constructor(
    public text: string,
    public paddingX: number,
    public paddingY: number
  ) {}

  render(width: number): string[] {
    return this.text.split('\n');
  }

  invalidate() {}
}

export class Container {
  children: any[] = [];

  addChild(child: any) {
    this.children.push(child);
  }

  render(width: number): string[] {
    return this.children.flatMap(c => c.render?.(width) || []);
  }

  invalidate() {}
}

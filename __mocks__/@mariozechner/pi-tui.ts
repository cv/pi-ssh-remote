// Mock for @mariozechner/pi-tui

export class Text {
	constructor(
		public text: string,
		public paddingX: number,
		public paddingY: number
	) {}

	render(_width: number): string[] {
		return this.text.split("\n");
	}

	invalidate(): void {}
}

interface Renderable {
	render?: (width: number) => string[];
}

export class Container {
	children: Renderable[] = [];

	addChild(child: Renderable): void {
		this.children.push(child);
	}

	render(width: number): string[] {
		return this.children.flatMap((c) => c.render?.(width) ?? []);
	}

	invalidate(): void {}
}

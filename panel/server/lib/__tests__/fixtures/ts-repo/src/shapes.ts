export interface Shape {
  width: number;
  height: number;
}

export function area(shape: Shape): number {
  return shape.width * shape.height;
}

package main

import (
	"hash/fnv"
	"math"
	"strings"
)

var fragmentDirections = [...]meshPoint{{1, .2, 0}, {-.7, .7, 0}, {-.8, -.5, 0}, {.3, -.9, 0}, {.3, .9, 0}, {-.2, -.8, 0}}

func shipIndex(id string) int {
	h := fnv.New32a()
	_, _ = h.Write([]byte(id))
	return int(h.Sum32()) % len(proceduralModels())
}

func shipFor(id string) string { return proceduralModels()[shipIndex(id)].Name }

func (m *model) step() {
	if !m.spinPaused {
		m.tick++
	}
}

func cellRank(row, col int) float64 {
	value := uint32(row)*73856093 ^ uint32(col)*19349663
	value ^= value >> 13
	value *= 0x5bd1e995
	value ^= value >> 15
	return float64(value%1000) / 1000
}

func shipLines(lane StationLane, tick, width, height int) []string {
	if width < 1 || height < 1 {
		return nil
	}
	asset := proceduralModels()[shipIndex(lane.ID)]
	motionTick, fracture := tick, 0.0
	if lane.SourceState == "failed" {
		motionTick = min(24, max(0, tick))
		fracture = float64(motionTick) / 24
	}
	triangles := shipTriangles(asset.geometry, motionTick, fracture)
	// Terminal cells are roughly twice as tall as they are wide.
	aspect := math.Min(float64(width)/2.0, float64(height))
	cols, rows := max(1, min(width, int(math.Ceil(aspect*2)))), max(1, min(height, int(math.Ceil(aspect))))
	out := make([]string, rows)
	for row := 0; row < rows; row++ {
		var line strings.Builder
		line.Grow(cols)
		for col := 0; col < cols; col++ {
			line.WriteRune(shipCell(lane, tick, triangles, row, col, rows, cols))
		}
		text := strings.TrimRight(line.String(), " ")
		if lane.SourceState == "blocked" {
			color := cRed
			if tick%4 < 2 {
				color = "#662222"
			}
			text = fg(color).Render(text)
		}
		out[row] = text
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}

// shipTriangles rotates and fractures the model, dropping degenerate triangles.
func shipTriangles(points []meshPoint, motionTick int, fracture float64) [][3]meshPoint {
	sin, cos := math.Sincos(float64(motionTick) * .08)
	triangles := make([][3]meshPoint, 0, len(points)/3)
	for i := 0; i < len(points)/3; i++ {
		var triangle [3]meshPoint
		direction := fragmentDirections[i%len(fragmentDirections)]
		for j := range triangle {
			p := points[i*3+j]
			z := p.z*cos - p.x*sin
			triangle[j] = meshPoint{
				x: p.x*cos + p.z*sin + direction.x*fracture*1.5,
				y: p.y*.92 - z*.28 + direction.y*fracture*1.5,
			}
		}
		a, b, c := triangle[0], triangle[1], triangle[2]
		if math.Abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)) > 1e-9 {
			triangles = append(triangles, triangle)
		}
	}
	return triangles
}

// shipCell picks the glyph for one terminal cell.
func shipCell(lane StationLane, tick int, triangles [][3]meshPoint, row, col, rows, cols int) rune {
	x := (float64(col)+.5)/float64(cols)*2 - 1
	y := 1 - (float64(row)+.5)/float64(rows)*2
	for _, triangle := range triangles {
		if insideTriangle(x, y, triangle) {
			rank := cellRank(row, col)
			if lane.SourceState == "failed" && rank < math.Min(1, float64(tick)/24) {
				return '·'
			} else if rank > lane.Progress {
				return '▒'
			}
			return '█'
		}
	}
	return ' '
}

func insideTriangle(x, y float64, t [3]meshPoint) bool {
	cross := func(a, b meshPoint) float64 { return (b.x-a.x)*(y-a.y) - (b.y-a.y)*(x-a.x) }
	a, b, c := cross(t[0], t[1]), cross(t[1], t[2]), cross(t[2], t[0])
	return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)
}

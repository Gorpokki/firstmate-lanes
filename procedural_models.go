package main

import (
	"encoding/binary"
	"math"
	"sync"
)

type meshPoint struct{ x, y, z float64 }

var proceduralCache []ModelAsset
var proceduralOnce sync.Once

func proceduralModels() []ModelAsset {
	proceduralOnce.Do(func() {
		scout, hauler := scoutMesh(), haulerMesh()
		scoutData, haulerData := encodeMesh(scout), encodeMesh(hauler)
		proceduralCache = []ModelAsset{
			{ID: "builtin.scout", Name: "Scout", Hi: scoutData, Lo: scoutData, geometry: scout},
			{ID: "builtin.hauler", Name: "Hauler", Hi: haulerData, Lo: haulerData, geometry: hauler},
		}
	})
	return proceduralCache
}

// Each consecutive triple is one outward-facing triangle; forward is +x.
func scoutMesh() []meshPoint {
	return []meshPoint{
		{1, 0, 0}, {-.72, .34, .3}, {-.72, -.34, .3},
		{1, 0, 0}, {-.72, -.34, -.3}, {-.72, .34, -.3},
		{1, 0, 0}, {-.72, .34, -.3}, {-.72, .34, .3},
		{1, 0, 0}, {-.72, -.34, .3}, {-.72, -.34, -.3},
		{-.72, .34, .3}, {-.72, .34, -.3}, {-.72, -.34, -.3},
		{-.72, .34, .3}, {-.72, -.34, -.3}, {-.72, -.34, .3},
		{-.2, .04, .97}, {-.8, .04, .26}, {-.55, .04, .26},
		{-.2, -.04, -.97}, {-.55, -.04, -.26}, {-.8, -.04, -.26},
	}
}

func haulerMesh() []meshPoint {
	return []meshPoint{
		{.9, 0, 0}, {-.48, .42, .42}, {-.48, -.42, .42},
		{.9, 0, 0}, {-.48, -.42, -.42}, {-.48, .42, -.42},
		{.9, 0, 0}, {-.48, .42, -.42}, {-.48, .42, .42},
		{.9, 0, 0}, {-.48, -.42, .42}, {-.48, -.42, -.42},
		{-.48, .42, .42}, {-.48, .42, -.42}, {-.48, -.42, -.42},
		{-.48, .42, .42}, {-.48, -.42, -.42}, {-.48, -.42, .42},
		{-.35, .93, 0}, {-.8, .4, .3}, {-.8, .4, -.3},
		{-.35, -.93, 0}, {-.8, -.4, -.3}, {-.8, -.4, .3},
		{-.82, .4, .28}, {-.82, -.4, .28}, {-.82, -.4, -.28},
		{-.82, .4, .28}, {-.82, -.4, -.28}, {-.82, .4, -.28},
	}
}

func encodeMesh(points []meshPoint) []byte {
	out := make([]byte, len(points)*6)
	for i, p := range points {
		for axis, value := range [...]float64{p.x, p.y, p.z} {
			v := int16(math.Round(value * 32767))
			binary.LittleEndian.PutUint16(out[i*6+axis*2:], uint16(v))
		}
	}
	return out
}

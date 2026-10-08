import * as THREE from 'three';

const tintedSurfaces = new Set(['Frosted_Polymer', 'Ivory_Edges', 'Index_Inlay', 'Case_Engraving', 'Case_Engraving_Highlight', 'Moulded_Lettering']);
type Surface = THREE.MeshPhysicalMaterial;
type CoverSurface = {
  enabled: { value: number }; color: { value: THREE.Color };
  baseline: Pick<Surface, 'roughness' | 'transmission' | 'thickness' | 'attenuationDistance'>;
};
const states = new WeakMap<Surface, CoverSurface>();

/** Extend the original glass/theme shader; no duplicate shells or extra render passes. */
export function setCoverSurface(material: Surface, name: string, enabled: boolean, tint: THREE.Color, instanced = false) {
  if (!tintedSurfaces.has(name)) return;
  let state = states.get(material);
  if (!state && !enabled) return;
  if (!state) {
    state = { enabled: { value: 0 }, color: { value: tint.clone() }, baseline: {
      roughness: material.roughness, transmission: material.transmission, thickness: material.thickness, attenuationDistance: material.attenuationDistance,
    } };
    states.set(material, state);
    const uniforms = state, before = material.onBeforeCompile, cache = material.customProgramCacheKey.bind(material)();
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      shader.uniforms.musicCoverMode = uniforms.enabled;
      shader.uniforms.musicCoverColor = uniforms.color;
      shader.fragmentShader = 'uniform float musicCoverMode; uniform vec3 musicCoverColor;\n' + shader.fragmentShader;
      let color = 'musicCoverColor';
      if (instanced) {
        shader.vertexShader = 'attribute vec3 musicBorderColor; varying vec3 vMusicBorderColor;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMusicBorderColor = musicBorderColor;');
        shader.fragmentShader = 'varying vec3 vMusicBorderColor;\n' + shader.fragmentShader;
        color = 'vMusicBorderColor';
      }
      const tintColor = name === 'Frosted_Polymer' ? `mix(vec3(1.0), ${color}, 0.18)` : color;
      // Run after the original height tint, reveal roughness and dark-theme color.
      const anchor = '#include <metalnessmap_fragment>';
      const roughness = name === 'Frosted_Polymer'
        ? instanced ? '0.10' : 'mix(0.10, 0.025, glassRevealAtHeight(archiveClarity, vArchiveHeight))'
        : '0.18';
      shader.fragmentShader = shader.fragmentShader.replace(anchor, `${anchor}\ndiffuseColor.rgb = mix(diffuseColor.rgb, ${tintColor}, musicCoverMode);\nroughnessFactor = mix(roughnessFactor, ${roughness}, musicCoverMode);`);
    };
    material.customProgramCacheKey = () => `${cache}-music-cover-glass-${instanced}-v1`;
    material.needsUpdate = true;
  }
  const wasEnabled = state.enabled.value > 0;
  state.enabled.value = Number(enabled); state.color.value.copy(tint);
  if (enabled && name === 'Frosted_Polymer') {
    material.transmission = .975; material.thickness = .024; material.attenuationDistance = 10;
  } else if (!enabled && wasEnabled) Object.assign(material, state.baseline);
}

export function setCoverGroup(group: THREE.Group, enabled: boolean, tint: THREE.Color) {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.surface) return;
    setCoverSurface(object.material as Surface, object.userData.surface, enabled, tint);
  });
}

export function coverSurfaceState(material: THREE.Material) { return states.get(material as Surface); }

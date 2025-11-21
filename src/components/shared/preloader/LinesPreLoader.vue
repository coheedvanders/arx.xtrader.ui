<template>
  <div class="preloader-container">
    <svg
      :width="width"
      :height="height"
      class="preloader-svg"
    >
      <!-- Definitions -->
      <defs>
        <!-- Animated gradient for flow -->
        <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#000" stop-opacity="0">
            <animate attributeName="stop-opacity" values="0;0.8;0" dur="2s" repeatCount="indefinite"/>
          </stop>
          <stop offset="50%" stop-color="#000" stop-opacity="0.8">
            <animate attributeName="stop-opacity" values="0;0.8;0" dur="2s" repeatCount="indefinite" begin="0.5s"/>
          </stop>
          <stop offset="100%" stop-color="#000" stop-opacity="0">
            <animate attributeName="stop-opacity" values="0;0.8;0" dur="2s" repeatCount="indefinite" begin="1s"/>
          </stop>
        </linearGradient>
      </defs>

      <!-- Connection lines -->
      <g v-for="(conn, index) in connections" :key="`connection-${index}`">
        <template v-if="getNodeById(conn.from) && getNodeById(conn.to)">
          <!-- Base line -->
          <line
            :x1="getNodeById(conn.from)!.x"
            :y1="getNodeById(conn.from)!.y"
            :x2="getNodeById(conn.to)!.x"
            :y2="getNodeById(conn.to)!.y"
            stroke="#000"
            stroke-width="1"
            :opacity="conn.active ? 0.6 : 0.3"
          />
          
          <!-- Animated flow line -->
          <line
            v-if="conn.active"
            :x1="getNodeById(conn.from)!.x"
            :y1="getNodeById(conn.from)!.y"
            :x2="getNodeById(conn.to)!.x"
            :y2="getNodeById(conn.to)!.y"
            stroke="url(#flowGradient)"
            stroke-width="2"
            opacity="0.8"
          />
        </template>
      </g>

      <!-- Network nodes -->
      <g v-for="(node, index) in nodes" :key="`node-${node.id}`">
        <!-- Outer pulse ring -->
        <circle
          :cx="node.x"
          :cy="node.y"
          :r="node.baseRadius * 1.5"
          fill="none"
          stroke="#000"
          stroke-width="1"
          opacity="0.4"
          class="pulse-ring"
          :style="{ 'animation-delay': (index * 0.3) + 's' }"
        />
        
        <!-- Core node -->
        <circle
          :cx="node.x"
          :cy="node.y"
          :r="node.baseRadius"
          fill="#000"
          opacity="0.8"
        />
        
        <!-- Inner core -->
        <circle
          :cx="node.x"
          :cy="node.y"
          :r="node.baseRadius * 0.4"
          fill="#666"
          opacity="0.6"
        />
      </g>

      <!-- Flowing data particles -->
      <circle
        v-for="particle in activeParticles"
        :key="particle.id"
        :cx="getParticlePosition(particle).x"
        :cy="getParticlePosition(particle).y"
        :r="particle.size"
        fill="#000"
        :opacity="getParticleOpacity(particle)"
        class="data-particle"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

// Props interface
interface Props {
  width?: number
  height?: number
  nodeCount?: number
  connectionDensity?: number
  seed?: number
}

// Props with defaults
const props = withDefaults(defineProps<Props>(), {
  width: 200,
  height: 100,
  nodeCount: 8,
  connectionDensity: 0.4,
  seed: 0
})

// Node interface
interface Node {
  id: string
  x: number
  y: number
  type: 'hub' | 'node' | 'satellite'
  baseRadius: number
}

// Connection interface
interface Connection {
  from: string
  to: string
  active: boolean
  distance: number
}

// Particle interface
interface Particle {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  progress: number
  active: boolean
  size: number
  speed: number
}

// Reactive state
const nodes = ref<Node[]>([])
const connections = ref<Connection[]>([])
const particles = ref<Particle[]>([])
const animationFrame = ref<number | null>(null)

// Computed properties
const activeParticles = computed(() => particles.value.filter(p => p.active))

// Seeded random number generator for consistent randomness
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed || Date.now()
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  choice<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)]
  }

  boolean(probability: number = 0.5): boolean {
    return this.next() < probability
  }
}

const rng = new SeededRandom(props.seed || Math.random() * 1000000)

// Helper functions
const getNodeById = (id: string): Node | undefined => {
  return nodes.value.find(n => n.id === id)
}

const getDistance = (node1: Node, node2: Node): number => {
  return Math.sqrt(Math.pow(node2.x - node1.x, 2) + Math.pow(node2.y - node1.y, 2))
}

const getParticlePosition = (particle: Particle) => {
  const t = particle.progress
  const x = particle.fromX + (particle.toX - particle.fromX) * t
  const y = particle.fromY + (particle.toY - particle.fromY) * t
  return { x, y }
}

const getParticleOpacity = (particle: Particle): number => {
  return Math.sin(particle.progress * Math.PI) * 0.6 + 0.2
}

// Generate random scattered nodes
const generateNodes = (): void => {
  const newNodes: Node[] = []
  const margin = 20
  const types: ('hub' | 'node' | 'satellite')[] = ['hub', 'node', 'satellite']
  
  // Ensure we have at least 2 hubs for connectivity
  const hubCount = Math.max(2, Math.floor(props.nodeCount * 0.3))
  
  for (let i = 0; i < props.nodeCount; i++) {
    let type: 'hub' | 'node' | 'satellite'
    
    if (i < hubCount) {
      type = 'hub'
    } else if (i < hubCount + Math.floor(props.nodeCount * 0.6)) {
      type = 'node'
    } else {
      type = 'satellite'
    }
    
    // Generate random position with margin
    const x = rng.range(margin, props.width - margin)
    const y = rng.range(margin, props.height - margin)
    
    // Random radius based on type
    let baseRadius: number
    switch (type) {
      case 'hub':
        baseRadius = rng.range(4, 7)
        break
      case 'satellite':
        baseRadius = rng.range(2, 3)
        break
      default:
        baseRadius = rng.range(3, 5)
    }
    
    newNodes.push({
      id: `node-${i}`,
      x,
      y,
      type,
      baseRadius
    })
  }
  
  nodes.value = newNodes
}

// Generate random connections based on distance and density
const generateConnections = (): void => {
  const newConnections: Connection[] = []
  const maxDistance = Math.sqrt(props.width * props.width + props.height * props.height) * 0.4
  
  for (let i = 0; i < nodes.value.length; i++) {
    for (let j = i + 1; j < nodes.value.length; j++) {
      const nodeA = nodes.value[i]
      const nodeB = nodes.value[j]
      const distance = getDistance(nodeA, nodeB)
      
      // Connection probability based on distance and node types
      let connectionProbability = props.connectionDensity
      
      // Hubs are more likely to connect
      if (nodeA.type === 'hub' || nodeB.type === 'hub') {
        connectionProbability *= 1.5
      }
      
      // Satellites are less likely to connect
      if (nodeA.type === 'satellite' || nodeB.type === 'satellite') {
        connectionProbability *= 0.6
      }
      
      // Closer nodes are more likely to connect
      const distanceFactor = Math.max(0, 1 - (distance / maxDistance))
      connectionProbability *= distanceFactor
      
      if (distance < maxDistance && rng.boolean(connectionProbability)) {
        const isActive = rng.boolean(0.7) // 70% of connections are active
        
        newConnections.push({
          from: nodeA.id,
          to: nodeB.id,
          active: isActive,
          distance
        })
      }
    }
  }
  
  // Ensure connectivity - connect isolated nodes to nearest hub
  nodes.value.forEach(node => {
    const hasConnection = newConnections.some(conn => 
      conn.from === node.id || conn.to === node.id
    )
    
    if (!hasConnection) {
      // Find nearest hub
      const hubs = nodes.value.filter(n => n.type === 'hub' && n.id !== node.id)
      if (hubs.length > 0) {
        const nearestHub = hubs.reduce((closest, hub) => {
          const distToHub = getDistance(node, hub)
          const distToClosest = getDistance(node, closest)
          return distToHub < distToClosest ? hub : closest
        })
        
        newConnections.push({
          from: node.id,
          to: nearestHub.id,
          active: true,
          distance: getDistance(node, nearestHub)
        })
      }
    }
  })
  
  connections.value = newConnections
}

// Initialize particles with random properties
const initializeParticles = (): void => {
  const newParticles: Particle[] = []
  
  connections.value.forEach((conn, connIndex) => {
    const fromNode = getNodeById(conn.from)
    const toNode = getNodeById(conn.to)
    
    if (fromNode && toNode && conn.active) {
      const particleCount = rng.range(1, 4)
      
      for (let i = 0; i < particleCount; i++) {
        newParticles.push({
          id: `${conn.from}-${conn.to}-${i}`,
          fromX: fromNode.x,
          fromY: fromNode.y,
          toX: toNode.x,
          toY: toNode.y,
          progress: rng.next(), // Random starting position
          active: conn.active,
          size: rng.range(1, 3),
          speed: rng.range(0.005, 0.02)
        })
      }
    }
  })
  
  particles.value = newParticles
}

// Animation loop
const animate = (): void => {
  particles.value = particles.value.map(particle => ({
    ...particle,
    progress: (particle.progress + particle.speed) % 1
  }))
  
  animationFrame.value = requestAnimationFrame(animate)
}

// Initialize everything
const initialize = (): void => {
  generateNodes()
  generateConnections()
  initializeParticles()
}

// Lifecycle hooks
onMounted(() => {
  initialize()
  animate()
})

onUnmounted(() => {
  if (animationFrame.value) {
    cancelAnimationFrame(animationFrame.value)
  }
})
</script>

<style scoped>
.preloader-container {
  display: inline-block;
}

.preloader-svg {
  display: block;
}

/* Pulse animation for node rings */
.pulse-ring {
  animation: pulse-ring 3s ease-in-out infinite;
}

@keyframes pulse-ring {
  0% {
    opacity: 0.4;
    transform-origin: center;
  }
  50% {
    opacity: 0.1;
  }
  100% {
    opacity: 0.4;
  }
}

/* Data particle animation */
.data-particle {
  animation: particle-pulse 2s ease-in-out infinite;
}

@keyframes particle-pulse {
  0%, 100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.8;
  }
}
</style>
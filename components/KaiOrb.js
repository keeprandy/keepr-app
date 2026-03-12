import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Polygon,
  Circle,
  G,
  Path,
} from "react-native-svg";

const AnimatedView = Animated.createAnimatedComponent(View);

function hexPoints(size, scale = 1, rotationDeg = -30) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) * scale;

  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = ((60 * i + rotationDeg) * Math.PI) / 180;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
}

function hexVertex(size, scale = 1, index = 0, rotationDeg = -30) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) * scale;
  const angle = ((60 * index + rotationDeg) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

export default function KaiOrb({
  size = 80,
  pulse = true,
  rotate = true,
  style,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0.82)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulse) return;

    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.045,
            duration: 2600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 2600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 1,
            duration: 2600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0.82,
            duration: 2600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulse, scale, glow]);

  useEffect(() => {
    if (!rotate) return;

    const rotateLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 22000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    rotateLoop.start();
    return () => rotateLoop.stop();
  }, [rotate, spin]);

  useEffect(() => {
    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ripple, {
          toValue: 1,
          duration: 3800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ripple, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    rippleLoop.start();
    return () => rippleLoop.stop();
  }, [ripple]);

  const spinDeg = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const canvas = size * 1.4;
  const center = canvas /1.4;
  const coreBox = size;

  const outerRingPoints = hexPoints(canvas, 0.6);
  const midRingPoints = hexPoints(canvas, 0.64);

  const coreOuter = hexPoints(coreBox, .8);
  const coreMid = hexPoints(coreBox, 2);
  const coreInner = hexPoints(coreBox, 2);

  const v0 = hexVertex(coreBox, 0.64, 0);
  const v2 = hexVertex(coreBox, 0.44, 2);
  const v4 = hexVertex(coreBox, 0.44, 4);
  const coreCenter = { x: coreBox / 2, y: coreBox / 2 };

  const neuralPath = `
    M ${v0.x} ${v0.y}
    Q ${coreCenter.x + coreBox * 0.10} ${coreCenter.y - coreBox * 0.10} ${v2.x} ${v2.y}
    M ${v2.x} ${v2.y}
    Q ${coreCenter.x - coreBox * 0.08} ${coreCenter.y + coreBox * 0.10} ${v4.x} ${v4.y}
    M ${v4.x} ${v4.y}
    Q ${coreCenter.x + coreBox * 0.02} ${coreCenter.y} ${v0.x} ${v0.y}
  `;

  return (
    <View
      style={[
        {
          width: canvas,
          height: canvas,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
      pointerEvents="none"
    >
      {/* ambient glow */}
      <AnimatedView
        style={{
          position: "absolute",
          width: canvas * 0.92,
          height: canvas * 0.92,
          borderRadius: 999,
          backgroundColor: "#2F6BFF",
          opacity: glow.interpolate({
            inputRange: [0.82, 1],
            outputRange: [0.05, 0.10],
          }),
          transform: [{ scale }],
        }}
      />

      <AnimatedView
        style={{
          position: "absolute",
          width: canvas * 0.62,
          height: canvas * 0.62,
          borderRadius: 999,
          backgroundColor: "#2d70d4",
          opacity: glow.interpolate({
            inputRange: [0.82, 1],
            outputRange: [0.04, 0.08],
          }),
          transform: [{ scale }],
        }}
      />

      {/* ripple */}
      <AnimatedView
        style={{
          position: "absolute",
          width: canvas * 0.58,
          height: canvas * 0.58,
          transform: [
            {
              scale: ripple.interpolate({
                inputRange: [0, 1],
                outputRange: [0.72, 1.18],
              }),
            },
          ],
          opacity: ripple.interpolate({
            inputRange: [0, 0.7, 1],
            outputRange: [0, 0.10, 0],
          }),
        }}
      >
          <Svg
            width={canvas * 0.58}
            height={canvas * 0.58}
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
          >
          <Polygon
            points={hexPoints(canvas * 0.58, 0.44)}
            fill="none"
            stroke="rgba(45, 95, 212, 0.35)"
            strokeWidth="1"
          />
        </Svg>
      </AnimatedView>

      {/* rotating shell */}
      <AnimatedView
        style={{
          position: "absolute",
          width: canvas,
          height: canvas,
          transform: [{ rotate: spinDeg }],
        }}
      >
        <Svg width={canvas} height={canvas} viewBox={`0 0 ${canvas} ${canvas}`}>
          <Polygon
            points={outerRingPoints}
            fill="none"
            stroke="rgba(47,107,255,0.22)"
            strokeWidth="1.8"
          />
          <Polygon
            points={midRingPoints}
            fill="none"
            stroke="rgba(45, 134, 212, 0.16)"
            strokeWidth="1.1"
          />
        </Svg>
      </AnimatedView>

      {/* core */}
      <AnimatedView
        style={{
          width: coreBox,
          height: coreBox,
          transform: [{ scale }],
        }}
      >
        <Svg width={coreBox} height={coreBox} viewBox={`0 0 ${coreBox} ${coreBox}`}>
          <Defs>
            <LinearGradient id="kaiHexCore" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#a7c7ff" />
              <Stop offset="26%" stopColor="#69a0ff" />
              <Stop offset="60%" stopColor="#2F6BFF" />
              <Stop offset="100%" stopColor="#14307D" />
            </LinearGradient>

            <RadialGradient id="kaiHexGlow" cx="50%" cy="42%" r="62%">
              <Stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
              <Stop offset="55%" stopColor="rgba(255,255,255,0.06)" />
              <Stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </RadialGradient>
          </Defs>

          <G>
            <Polygon
              points={coreOuter}
              fill="url(#kaiHexCore)"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="1.2"
            />

            <Polygon
              points={coreMid}
              fill="none"
              stroke="rgba(45,212,191,0.20)"
              strokeWidth="1"
            />

            <Polygon
              points={coreInner}
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="0.9"
            />

            {/* neural lines */}
            <Path
              d={neuralPath}
              fill="none"
              stroke="rgba(173,240,255,0.38)"
              strokeWidth="0.9"
              strokeLinecap="round"
            />

            {/* node hints */}
            <Circle cx={v0.x} cy={v0.y} r="1.6" fill="rgba(173, 207, 255, 0.65)" />
            <Circle cx={v2.x} cy={v2.y} r="1.4" fill="rgba(173, 207, 255, 0.65)" />
            <Circle cx={v4.x} cy={v4.y} r="1.4" fill="rgba(173, 207, 255, 0.65)" />

            {/* inner glow */}
            <Polygon
              points={coreOuter}
              fill="url(#kaiHexGlow)"
              opacity="0.55"
            />
          </G>
        </Svg>
      </AnimatedView>
    </View>
  );
}
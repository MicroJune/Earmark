import React, { useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootTabParamList, HomeStackParamList } from '../types';
import { useTheme, useThemeControl } from '../theme/ThemeProvider';
import type { Palette } from '../constants/colors';
import HomeScreen from '../screens/HomeScreen';
import CategoryScreen from '../screens/CategoryScreen';
import ContentViewScreen from '../screens/ContentViewScreen';
import LibraryScreen from '../screens/LibraryScreen';
import ReviewScreen from '../screens/ReviewScreen';
import MiniPlayerBar from '../components/MiniPlayerBar';

const Tab = createBottomTabNavigator<RootTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();

function HomeStackNavigator() {
  const c = useTheme();
  return (
    <HomeStack.Navigator
      screenOptions={{
        headerTintColor: c.primary,
        headerTitleStyle: { fontWeight: '700' },
        headerStyle: { backgroundColor: c.surface },
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <HomeStack.Screen
        name="HomeScreen"
        component={HomeScreen}
        options={{ title: 'Earmark' }}
      />
      <HomeStack.Screen
        name="CategoryView"
        component={CategoryScreen}
        options={({ route }) => ({ title: route.params.categoryName })}
      />
      <HomeStack.Screen
        name="ContentView"
        component={ContentViewScreen}
        options={{ title: '' }}
      />
    </HomeStack.Navigator>
  );
}

// Map our palette onto React Navigation's theme so the container background,
// headers and tab bar all follow the active theme (no white flashes on dark).
function navTheme(c: Palette, scheme: 'light' | 'dark'): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
      notification: c.primary,
    },
  };
}

export function AppNavigation() {
  const c = useTheme();
  const { scheme } = useThemeControl();
  const theme = useMemo(() => navTheme(c, scheme), [c, scheme]);

  return (
    <NavigationContainer theme={theme}>
      <Tab.Navigator
        tabBar={(props) => (
          <>
            <MiniPlayerBar />
            <BottomTabBar {...props} />
          </>
        )}
        screenOptions={({ route }) => ({
          headerShown: false,
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.primary,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.textSecondary,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
          tabBarIcon: ({ focused, color, size }) => {
            const icons: Record<string, [string, string]> = {
              Home:    ['home',    'home-outline'],
              Library: ['library', 'library-outline'],
              Review:  ['school',  'school-outline'],
            };
            const [filled, outline] = icons[route.name] ?? ['ellipse', 'ellipse-outline'];
            return <Ionicons name={(focused ? filled : outline) as any} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home"    component={HomeStackNavigator} />
        <Tab.Screen name="Library" component={LibraryScreen}      options={{ headerShown: true }} />
        <Tab.Screen name="Review"  component={ReviewScreen}       options={{ headerShown: true }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

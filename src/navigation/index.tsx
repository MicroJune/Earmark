import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootTabParamList, HomeStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import HomeScreen from '../screens/HomeScreen';
import CategoryScreen from '../screens/CategoryScreen';
import ContentViewScreen from '../screens/ContentViewScreen';
import LibraryScreen from '../screens/LibraryScreen';
import ReviewScreen from '../screens/ReviewScreen';

const Tab = createBottomTabNavigator<RootTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator
      screenOptions={{
        headerTintColor: COLORS.primary,
        headerTitleStyle: { fontWeight: '700' },
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

export function AppNavigation() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textSecondary,
          tabBarStyle: { borderTopColor: COLORS.border },
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
        <Tab.Screen name="Library" component={LibraryScreen}      options={{ headerShown: true, headerTintColor: COLORS.primary }} />
        <Tab.Screen name="Review"  component={ReviewScreen}       options={{ headerShown: true, headerTintColor: COLORS.primary }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

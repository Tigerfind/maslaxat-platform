import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { PaperProvider, DefaultTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Notifications from 'expo-notifications';

import store from './src/store/store';
import { authActions } from './src/store/slices/authSlice';
import { initializeApp } from './src/store/slices/appSlice';

// Navigation
import AuthNavigator from './src/navigation/AuthNavigator';
import MainNavigator from './src/navigation/MainNavigator';
import LoadingScreen from './src/screens/LoadingScreen';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Custom theme
const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#f5f5f5',
    surface: '#ffffff',
    text: '#333333',
  },
};

const Stack = createStackNavigator();

// Main App Content
const AppContent = () => {
  const dispatch = useDispatch();
  const { isAuthenticated, isLoading, checkingAuth } = useSelector((state) => state.auth);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    // Initialize app
    dispatch(initializeApp());
    
    // Check authentication status
    dispatch(authActions.checkAuthStatus());

    // Request notification permissions
    requestNotificationPermissions();

    // Set up notification listeners
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      setNotification(notification);
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      handleNotificationResponse(response);
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, [dispatch]);

  const requestNotificationPermissions = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Toast.show({
        type: 'info',
        text1: 'Notifications',
        text2: 'Please enable notifications to receive important updates.',
      });
    }
  };

  const handleNotificationResponse = (response) => {
    const data = response.notification.request.content.data;
    
    // Handle different notification types
    if (data.type === 'consultation_reminder') {
      // Navigate to consultation screen
      navigation.navigate('Consultation', { consultationId: data.consultationId });
    } else if (data.type === 'new_message') {
      // Navigate to chat screen
      navigation.navigate('Chat', { consultationId: data.consultationId });
    } else if (data.type === 'payment_status') {
      // Navigate to payments screen
      navigation.navigate('Payments');
    }
  };

  if (checkingAuth) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
      <Toast ref={(ref) => Toast.setRef(ref)} />
    </NavigationContainer>
  );
};

// Main App Component
export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <AppContent />
        </PaperProvider>
      </SafeAreaProvider>
    </Provider>
  );
}
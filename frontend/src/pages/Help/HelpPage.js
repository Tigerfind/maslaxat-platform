import React from 'react';
import { Container, Typography, Box } from '@mui/material';

const HelpPage = () => {
  return (
    <Container>
      <Box sx={{ mt: 4 }}>
        <Typography variant="h4">HelpPage</Typography>
        <Typography variant="body1" sx={{ mt: 2 }}>
          This page is under development.
        </Typography>
      </Box>
    </Container>
  );
};

export default HelpPage;

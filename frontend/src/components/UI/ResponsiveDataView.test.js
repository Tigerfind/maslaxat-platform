import React from 'react';
import { render, screen } from '@testing-library/react';
import ResponsiveDataView, { MobileDataField } from './ResponsiveDataView';

describe('ResponsiveDataView', () => {
  test('renders the desktop view and semantic mobile cards from the same rows', () => {
    render(
      <ResponsiveDataView
        items={[{ id: 'row-1', name: 'Ada' }]}
        mobileLabel="Users"
        desktop={<table><tbody><tr><td>Desktop Ada</td></tr></tbody></table>}
        renderMobileItem={(item) => (
          <dl><MobileDataField label="Name">{item.name}</MobileDataField></dl>
        )}
      />
    );

    expect(screen.getByTestId('responsive-data-table')).toHaveTextContent('Desktop Ada');
    expect(screen.getByRole('region', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Name');
    expect(screen.getByRole('article')).toHaveTextContent('Ada');
  });
});

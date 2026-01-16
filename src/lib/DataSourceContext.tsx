'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { DataSource, SCENARIO_LABELS } from './demo-data';

interface DataSourceContextType {
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
  isDemo: boolean;
  scenarioLabel: { label: string; icon: string; color: string };
}

const DataSourceContext = createContext<DataSourceContextType | null>(null);

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [dataSource, setDataSource] = useState<DataSource>('production');
  
  const isDemo = dataSource !== 'production';
  const scenarioLabel = SCENARIO_LABELS[dataSource];

  return (
    <DataSourceContext.Provider value={{ 
      dataSource, 
      setDataSource, 
      isDemo,
      scenarioLabel 
    }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  const context = useContext(DataSourceContext);
  if (!context) {
    throw new Error('useDataSource must be used within a DataSourceProvider');
  }
  return context;
}

export default DataSourceProvider;

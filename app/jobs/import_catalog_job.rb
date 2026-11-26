class ImportCatalogJob < ApplicationJob
  queue_as :default

  def perform
    CatalogImport.new.call
  end
end
